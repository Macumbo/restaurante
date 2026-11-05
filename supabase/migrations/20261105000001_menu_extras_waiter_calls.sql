-- Ideias do protótipo MesaFácil: destaque do dia, alergénios, tempo de preparação,
-- frase do restaurante e chamar o garçom.

alter table public.restaurants
  add column tagline jsonb not null default '{}'::jsonb;

alter table public.restaurants alter column primary_color set default '#EA580C';
alter table public.restaurants alter column accent_color set default '#0F172A';

alter table public.dishes
  add column allergens jsonb not null default '{}'::jsonb,
  add column prep_minutes int check (prep_minutes between 0 and 240),
  add column is_special boolean not null default false;

-- ---------------------------------------------------------------------------
-- Chamar o garçom
-- ---------------------------------------------------------------------------

create table public.waiter_calls (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  session_id uuid not null references public.table_sessions(id) on delete cascade,
  participant_id uuid not null references public.session_participants(id) on delete cascade,
  reason text not null check (reason in ('assist', 'bill', 'water', 'cutlery')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id)
);

-- Uma chamada aberta por motivo e por mesa (evita chamadas repetidas)
create unique index waiter_calls_one_open
  on public.waiter_calls (session_id, reason)
  where resolved_at is null;

alter table public.waiter_calls enable row level security;

create policy waiter_calls_read on public.waiter_calls for select
  using (public.is_staff(restaurant_id) or public.is_participant(session_id));

create or replace function public.call_waiter(p_session_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_session public.table_sessions;
  v_participant public.session_participants;
begin
  select * into v_session from public.table_sessions where id = p_session_id;
  if not found or v_session.status not in ('pending', 'confirmed') then
    raise exception 'session_not_open';
  end if;
  select * into v_participant from public.session_participants
  where session_id = p_session_id and user_id = auth.uid();
  if not found then
    raise exception 'not_participant';
  end if;

  insert into public.waiter_calls (restaurant_id, session_id, participant_id, reason)
  values (v_session.restaurant_id, p_session_id, v_participant.id, p_reason)
  on conflict (session_id, reason) where resolved_at is null do nothing;
end;
$$;

create or replace function public.resolve_waiter_call(p_call_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_call public.waiter_calls;
begin
  select * into v_call from public.waiter_calls where id = p_call_id;
  if not found or not public.has_role(v_call.restaurant_id, array['owner', 'manager', 'waiter']) then
    raise exception 'forbidden';
  end if;
  update public.waiter_calls
     set resolved_at = now(), resolved_by = auth.uid()
   where id = p_call_id and resolved_at is null;
end;
$$;

revoke all on function public.call_waiter(uuid, text) from public;
revoke all on function public.resolve_waiter_call(uuid) from public;
grant execute on function public.call_waiter(uuid, text) to authenticated;
grant execute on function public.resolve_waiter_call(uuid) to authenticated;

-- Ao fechar ou cancelar a sessão, as chamadas abertas ficam resolvidas
create or replace function public.close_calls_on_session_end()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.status in ('closed', 'cancelled') and old.status not in ('closed', 'cancelled') then
    update public.waiter_calls set resolved_at = now()
     where session_id = new.id and resolved_at is null;
  end if;
  return new;
end;
$$;

create trigger table_sessions_close_calls
  after update of status on public.table_sessions
  for each row execute function public.close_calls_on_session_end();

alter publication supabase_realtime add table public.waiter_calls;
