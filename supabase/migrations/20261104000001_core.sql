-- Núcleo da plataforma: restaurantes, equipa, menu, mesas, sessões e pedidos.
-- Cada tabela tem restaurant_id e políticas RLS para separar os dados de cada restaurante.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Restaurantes e equipa
-- ---------------------------------------------------------------------------

create table public.restaurants (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]+$'),
  name text not null,
  nif text,
  logo_url text,
  primary_color text not null default '#B4532A',
  accent_color text not null default '#2F6F4F',
  currency text not null default 'AOA',
  default_vat_rate numeric(5,2) not null default 14,
  created_at timestamptz not null default now()
);

create table public.restaurant_members (
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'manager', 'waiter', 'kitchen')),
  display_name text,
  created_at timestamptz not null default now(),
  primary key (restaurant_id, user_id, role)
);

-- O utilizador atual tem algum destes papéis no restaurante?
create or replace function public.has_role(p_restaurant uuid, p_roles text[])
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.restaurant_members m
    where m.restaurant_id = p_restaurant
      and m.user_id = auth.uid()
      and m.role = any (p_roles)
  );
$$;

create or replace function public.is_staff(p_restaurant uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.has_role(p_restaurant, array['owner', 'manager', 'waiter', 'kitchen']);
$$;

create or replace function public.is_manager(p_restaurant uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.has_role(p_restaurant, array['owner', 'manager']);
$$;

-- ---------------------------------------------------------------------------
-- Menu (cada restaurante tem o seu; nada é partilhado)
-- Textos visíveis ao cliente são jsonb por idioma: {"pt": "...", "en": "..."}
-- ---------------------------------------------------------------------------

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  name jsonb not null,
  position int not null default 0,
  active boolean not null default true
);

create table public.dishes (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  category_id uuid references public.categories(id) on delete set null,
  name jsonb not null,
  description jsonb not null default '{}'::jsonb,
  ingredients jsonb not null default '{}'::jsonb,
  price numeric(12,2) not null check (price >= 0),
  vat_rate numeric(5,2),
  photo_url text,
  available_today boolean not null default true,
  active boolean not null default true,
  position int not null default 0,
  created_at timestamptz not null default now()
);

-- Ajustes do prato: retirar (ex.: sem cebola) ou adicionar (ex.: limão, queijo extra)
create table public.dish_modifiers (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  dish_id uuid not null references public.dishes(id) on delete cascade,
  kind text not null check (kind in ('remove', 'add')),
  name jsonb not null,
  extra_price numeric(12,2) not null default 0 check (extra_price >= 0),
  position int not null default 0,
  active boolean not null default true
);

-- ---------------------------------------------------------------------------
-- Mesas e sessões de mesa
-- ---------------------------------------------------------------------------

create table public.dining_tables (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  label text not null,
  seats int,
  qr_token text not null unique default encode(gen_random_bytes(12), 'hex'),
  active boolean not null default true,
  unique (restaurant_id, label)
);

create table public.table_sessions (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  table_id uuid not null references public.dining_tables(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'closed', 'cancelled')),
  opened_at timestamptz not null default now(),
  confirmed_at timestamptz,
  confirmed_by uuid references auth.users(id),
  closed_at timestamptz
);

-- No máximo uma sessão aberta por mesa
create unique index table_sessions_one_open
  on public.table_sessions (table_id)
  where status in ('pending', 'confirmed');

create table public.session_participants (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.table_sessions(id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null,
  joined_at timestamptz not null default now(),
  unique (session_id, user_id)
);

create or replace function public.is_participant(p_session uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.session_participants p
    where p.session_id = p_session and p.user_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------------
-- Pedidos
-- ---------------------------------------------------------------------------

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  session_id uuid not null references public.table_sessions(id) on delete cascade,
  participant_id uuid not null references public.session_participants(id),
  status text not null
    check (status in ('pending_approval', 'approved', 'preparing', 'ready',
                      'delivered', 'rejected', 'cancelled')),
  note text,
  total numeric(12,2) not null default 0,
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  approved_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

create index orders_restaurant_status on public.orders (restaurant_id, status);
create index orders_session on public.orders (session_id);

-- Itens com cópia do nome, preço e ajustes no momento do pedido,
-- para que o histórico não mude quando o menu mudar.
create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  dish_id uuid references public.dishes(id) on delete set null,
  dish_name jsonb not null,
  quantity int not null check (quantity between 1 and 50),
  unit_price numeric(12,2) not null,
  vat_rate numeric(5,2) not null,
  modifiers jsonb not null default '[]'::jsonb,
  note text,
  line_total numeric(12,2) not null
);

create index order_items_order on public.order_items (order_id);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.restaurants enable row level security;
alter table public.restaurant_members enable row level security;
alter table public.categories enable row level security;
alter table public.dishes enable row level security;
alter table public.dish_modifiers enable row level security;
alter table public.dining_tables enable row level security;
alter table public.table_sessions enable row level security;
alter table public.session_participants enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;

-- Restaurantes: nome, logo e cores são públicos (o cliente precisa deles para a marca)
create policy restaurants_read on public.restaurants for select using (true);
create policy restaurants_update on public.restaurants for update
  using (public.is_manager(id)) with check (public.is_manager(id));

create policy members_read on public.restaurant_members for select
  using (user_id = auth.uid() or public.is_manager(restaurant_id));
create policy members_write on public.restaurant_members for all
  using (public.has_role(restaurant_id, array['owner']))
  with check (public.has_role(restaurant_id, array['owner']));

-- Menu: leitura pública; escrita só gestor
create policy categories_read on public.categories for select
  using (active or public.is_staff(restaurant_id));
create policy categories_write on public.categories for all
  using (public.is_manager(restaurant_id)) with check (public.is_manager(restaurant_id));

create policy dishes_read on public.dishes for select
  using (active or public.is_staff(restaurant_id));
create policy dishes_write on public.dishes for all
  using (public.is_manager(restaurant_id)) with check (public.is_manager(restaurant_id));

create policy modifiers_read on public.dish_modifiers for select
  using (active or public.is_staff(restaurant_id));
create policy modifiers_write on public.dish_modifiers for all
  using (public.is_manager(restaurant_id)) with check (public.is_manager(restaurant_id));

-- Mesas: o token do QR é secreto, só a equipa lê a tabela
create policy tables_read on public.dining_tables for select
  using (public.is_staff(restaurant_id));
create policy tables_write on public.dining_tables for all
  using (public.is_manager(restaurant_id)) with check (public.is_manager(restaurant_id));

-- Sessões, participantes e pedidos: equipa do restaurante ou quem está na mesa.
-- Escritas dos clientes passam apenas pelas funções abaixo.
create policy sessions_read on public.table_sessions for select
  using (public.is_staff(restaurant_id) or public.is_participant(id));

create policy participants_read on public.session_participants for select
  using (public.is_staff(restaurant_id) or public.is_participant(session_id));

create policy orders_read on public.orders for select
  using (public.is_staff(restaurant_id) or public.is_participant(session_id));

create policy order_items_read on public.order_items for select
  using (
    public.is_staff(restaurant_id)
    or exists (select 1 from public.orders o
               where o.id = order_id and public.is_participant(o.session_id))
  );

-- ---------------------------------------------------------------------------
-- Funções de negócio
-- ---------------------------------------------------------------------------

-- Cliente lê o QR: entra (ou abre) a sessão da mesa.
-- Uma sessão pendente sem aprovação há mais de 15 minutos é cancelada.
create or replace function public.join_table(p_token text, p_display_name text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_table public.dining_tables;
  v_session public.table_sessions;
  v_participant public.session_participants;
  v_name text := nullif(trim(coalesce(p_display_name, '')), '');
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if v_name is null or length(v_name) > 40 then
    raise exception 'invalid_name';
  end if;

  select * into v_table from public.dining_tables
  where qr_token = p_token and active;
  if not found then
    raise exception 'table_not_found';
  end if;

  update public.table_sessions
     set status = 'cancelled', closed_at = now()
   where table_id = v_table.id
     and status = 'pending'
     and opened_at < now() - interval '15 minutes';

  update public.orders o
     set status = 'cancelled', updated_at = now()
    from public.table_sessions s
   where o.session_id = s.id and s.table_id = v_table.id
     and s.status = 'cancelled' and o.status = 'pending_approval';

  select * into v_session from public.table_sessions
  where table_id = v_table.id and status in ('pending', 'confirmed');

  if not found then
    insert into public.table_sessions (restaurant_id, table_id)
    values (v_table.restaurant_id, v_table.id)
    returning * into v_session;
  end if;

  insert into public.session_participants (session_id, restaurant_id, user_id, display_name)
  values (v_session.id, v_table.restaurant_id, v_uid, v_name)
  on conflict (session_id, user_id) do update set display_name = excluded.display_name
  returning * into v_participant;

  return jsonb_build_object(
    'session_id', v_session.id,
    'session_status', v_session.status,
    'participant_id', v_participant.id,
    'restaurant_id', v_table.restaurant_id,
    'table_label', v_table.label
  );
end;
$$;

-- Cliente faz um pedido. Os preços são sempre calculados aqui, nunca vêm do telemóvel.
-- p_items: [{"dish_id": uuid, "quantity": int, "modifier_ids": [uuid], "note": text}]
create or replace function public.place_order(p_session_id uuid, p_items jsonb, p_note text default null)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_session public.table_sessions;
  v_participant public.session_participants;
  v_restaurant public.restaurants;
  v_order_id uuid;
  v_item jsonb;
  v_dish public.dishes;
  v_qty int;
  v_mods jsonb;
  v_mods_total numeric(12,2);
  v_unit numeric(12,2);
  v_total numeric(12,2) := 0;
  v_mod_ids uuid[];
begin
  select * into v_session from public.table_sessions where id = p_session_id;
  if not found or v_session.status not in ('pending', 'confirmed') then
    raise exception 'session_not_open';
  end if;

  select * into v_participant from public.session_participants
  where session_id = p_session_id and user_id = v_uid;
  if not found then
    raise exception 'not_participant';
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'empty_order';
  end if;

  select * into v_restaurant from public.restaurants where id = v_session.restaurant_id;

  insert into public.orders (restaurant_id, session_id, participant_id, status, note)
  values (
    v_session.restaurant_id, p_session_id, v_participant.id,
    case when v_session.status = 'confirmed' then 'approved' else 'pending_approval' end,
    nullif(trim(coalesce(p_note, '')), '')
  )
  returning id into v_order_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    select * into v_dish from public.dishes
    where id = (v_item->>'dish_id')::uuid
      and restaurant_id = v_session.restaurant_id
      and active and available_today;
    if not found then
      raise exception 'dish_unavailable';
    end if;

    v_qty := coalesce((v_item->>'quantity')::int, 1);
    if v_qty < 1 or v_qty > 50 then
      raise exception 'invalid_quantity';
    end if;

    select coalesce(array_agg(x::uuid), '{}') into v_mod_ids
    from jsonb_array_elements_text(coalesce(v_item->'modifier_ids', '[]'::jsonb)) x;

    select coalesce(jsonb_agg(jsonb_build_object(
             'id', m.id, 'kind', m.kind, 'name', m.name, 'extra_price', m.extra_price)
             order by m.position), '[]'::jsonb),
           coalesce(sum(m.extra_price), 0)
      into v_mods, v_mods_total
      from public.dish_modifiers m
     where m.id = any (v_mod_ids) and m.dish_id = v_dish.id and m.active;

    if jsonb_array_length(v_mods) <> coalesce(array_length(v_mod_ids, 1), 0) then
      raise exception 'invalid_modifier';
    end if;

    v_unit := v_dish.price + v_mods_total;

    insert into public.order_items
      (order_id, restaurant_id, dish_id, dish_name, quantity, unit_price, vat_rate,
       modifiers, note, line_total)
    values
      (v_order_id, v_session.restaurant_id, v_dish.id, v_dish.name, v_qty, v_unit,
       coalesce(v_dish.vat_rate, v_restaurant.default_vat_rate),
       v_mods, nullif(left(trim(coalesce(v_item->>'note', '')), 200), ''), v_unit * v_qty);

    v_total := v_total + v_unit * v_qty;
  end loop;

  update public.orders set total = v_total where id = v_order_id;
  return v_order_id;
end;
$$;

-- Garçom confirma que a mesa está no restaurante: aprova a sessão e os pedidos pendentes.
create or replace function public.approve_session(p_session_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_session public.table_sessions;
begin
  select * into v_session from public.table_sessions where id = p_session_id for update;
  if not found then
    raise exception 'session_not_found';
  end if;
  if not public.has_role(v_session.restaurant_id, array['owner', 'manager', 'waiter']) then
    raise exception 'forbidden';
  end if;
  if v_session.status <> 'pending' then
    raise exception 'session_not_pending';
  end if;

  update public.table_sessions
     set status = 'confirmed', confirmed_at = now(), confirmed_by = auth.uid()
   where id = p_session_id;

  update public.orders
     set status = 'approved', approved_at = now(), approved_by = auth.uid(), updated_at = now()
   where session_id = p_session_id and status = 'pending_approval';
end;
$$;

-- Garçom recusa: a sessão fecha e os pedidos pendentes são recusados.
create or replace function public.reject_session(p_session_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_session public.table_sessions;
begin
  select * into v_session from public.table_sessions where id = p_session_id for update;
  if not found then
    raise exception 'session_not_found';
  end if;
  if not public.has_role(v_session.restaurant_id, array['owner', 'manager', 'waiter']) then
    raise exception 'forbidden';
  end if;
  if v_session.status <> 'pending' then
    raise exception 'session_not_pending';
  end if;

  update public.table_sessions set status = 'cancelled', closed_at = now() where id = p_session_id;
  update public.orders set status = 'rejected', updated_at = now()
   where session_id = p_session_id and status = 'pending_approval';
end;
$$;

-- Cozinha e garçom avançam o estado do pedido.
create or replace function public.set_order_status(p_order_id uuid, p_status text)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_order public.orders;
  v_ok boolean;
begin
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'order_not_found';
  end if;

  v_ok := case
    when v_order.status = 'approved'  and p_status = 'preparing'
      then public.has_role(v_order.restaurant_id, array['owner', 'manager', 'kitchen'])
    when v_order.status = 'preparing' and p_status = 'ready'
      then public.has_role(v_order.restaurant_id, array['owner', 'manager', 'kitchen'])
    when v_order.status in ('approved', 'preparing', 'ready') and p_status = 'delivered'
      then public.has_role(v_order.restaurant_id, array['owner', 'manager', 'waiter'])
    when v_order.status in ('approved', 'preparing') and p_status = 'cancelled'
      then public.has_role(v_order.restaurant_id, array['owner', 'manager', 'waiter'])
    else false
  end;

  if not v_ok then
    raise exception 'invalid_transition';
  end if;

  update public.orders set status = p_status, updated_at = now() where id = p_order_id;
end;
$$;

-- Gestor gera um novo QR para uma mesa (o antigo deixa de funcionar).
create or replace function public.regenerate_table_token(p_table_id uuid)
returns text
language plpgsql security definer set search_path = public
as $$
declare
  v_table public.dining_tables;
  v_token text := encode(gen_random_bytes(12), 'hex');
begin
  select * into v_table from public.dining_tables where id = p_table_id;
  if not found or not public.is_manager(v_table.restaurant_id) then
    raise exception 'forbidden';
  end if;
  update public.dining_tables set qr_token = v_token where id = p_table_id;
  return v_token;
end;
$$;

revoke all on function public.join_table(text, text) from public;
revoke all on function public.place_order(uuid, jsonb, text) from public;
revoke all on function public.approve_session(uuid) from public;
revoke all on function public.reject_session(uuid) from public;
revoke all on function public.set_order_status(uuid, text) from public;
revoke all on function public.regenerate_table_token(uuid) from public;
grant execute on function public.join_table(text, text) to authenticated;
grant execute on function public.place_order(uuid, jsonb, text) to authenticated;
grant execute on function public.approve_session(uuid) to authenticated;
grant execute on function public.reject_session(uuid) to authenticated;
grant execute on function public.set_order_status(uuid, text) to authenticated;
grant execute on function public.regenerate_table_token(uuid) to authenticated;

-- Tempo real para garçom, cozinha e clientes
alter publication supabase_realtime add table public.orders;
alter publication supabase_realtime add table public.table_sessions;
