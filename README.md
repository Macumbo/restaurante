# Restaurante — pedidos à mesa pelo telemóvel

Plataforma web para vários restaurantes: o cliente lê o QR da mesa, vê o menu e faz pedidos;
o garçom confirma a mesa no 1.º pedido; a cozinha recebe os pedidos em tempo real; o gestor
configura pratos, ajustes, mesas e a marca. Tudo funciona no telemóvel. Português e inglês ativos.

Documento de arquitetura: <https://claude.ai/artifact/BXyLbKxhpKbVDen56ec3fy>

## Ecrãs

| Endereço | Quem usa | O que faz |
| --- | --- | --- |
| `/m/<token>` | Cliente | Menu, ajustes do prato (ex.: sem cebola), carrinho, pedidos da mesa em tempo real |
| `/staff` | Equipa | Login e escolha do ecrã |
| `/staff/waiter` | Garçom | Confirma ou recusa mesas novas, marca pedidos entregues, vê mesas abertas |
| `/staff/kitchen` | Cozinha | Pedidos novos → em preparação → prontos, com ajustes e notas em destaque |
| `/staff/manage` | Gestor / proprietário | Pratos (PT/EN), ajustes, categorias, disponível hoje, mesas e QR, cores e logo |

## Tecnologia

- Next.js 15 (React 19, TypeScript, Tailwind CSS 4)
- Supabase: PostgreSQL com RLS por restaurante, autenticação, tempo real
- As regras de negócio estão em funções SQL (`supabase/migrations`): preços calculados no
  servidor, aprovação do 1.º pedido, transições de estado por papel.

## Correr localmente

Requisitos: Node 20+, Docker.

```bash
npm install
npx supabase start          # base de dados local, aplica migrações e seed.sql
cp .env.example .env.local  # preencher com o "API URL" e a "anon key" mostrados acima
npm run dev
```

Abra <http://localhost:3000/m/demo-mesa-1> para a mesa de demonstração.

### Criar a equipa

1. Crie os utilizadores (Supabase Studio → Authentication → Add user, com email e palavra-passe).
2. Ligue-os ao restaurante no SQL Editor:

```sql
insert into restaurant_members (restaurant_id, user_id, role, display_name)
select '00000000-0000-0000-0000-000000000001', id, 'owner', 'Proprietário'
from auth.users where email = 'dono@exemplo.ao';
-- papéis: owner, manager, waiter, kitchen (uma pessoa pode ter vários)
```

## Publicar a demo (Vercel + Supabase, planos gratuitos)

1. **Supabase:** criar um projeto (região mais próxima: Europa). Em *Authentication → Sign In / Providers*,
   ativar **Allow anonymous sign-ins** (os clientes pedem sem registo).
   Aplicar as migrações: `npx supabase link --project-ref <ref>` e `npx supabase db push`.
   Para dados de demonstração, correr `supabase/seed.sql` no SQL Editor.
2. **Vercel:** importar o repositório e definir `NEXT_PUBLIC_SUPABASE_URL` e
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
3. **Subdomínio da SIKADA:** em *Vercel → Settings → Domains* adicionar, por exemplo,
   `restaurante.sikada.<domínio>`, e no DNS do cPanel criar o registo CNAME indicado pela Vercel.

Nota: no plano gratuito, o Supabase pausa o projeto após 7 dias sem uso; basta reativá-lo no painel.

## Ainda não incluído (próxima parte do passo 2)

Divisão da conta e registo de pagamentos, livro de vendas, chat com o garçom, avaliação,
conta opcional do cliente com histórico e favoritos.
