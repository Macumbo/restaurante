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

- Next.js 16 (React 19, TypeScript, Tailwind CSS 4)
- Supabase: PostgreSQL com RLS por restaurante, autenticação, tempo real
- As regras de negócio estão em funções SQL (`supabase/migrations`): preços calculados no
  servidor, aprovação do 1.º pedido, transições de estado por papel.

## Correr localmente

Requisitos: Node 22+, Docker.

```bash
npm install
npx supabase@2 start        # base de dados local (Docker), aplica migrações e seed.sql
cp .env.example .env.local  # preencher com o "API URL" e a "anon key" mostrados acima
npm run dev
```

Abra <http://localhost:3000/m/demo-mesa-1> para a mesa de demonstração.

### Correr com Docker

O `docker-compose.yml` corre só a aplicação. A base de dados tem de ser o Supabase completo
(Postgres + Auth + REST + Realtime), que o `npx supabase@2 start` já põe a correr em Docker.
Um Postgres simples não chega: a aplicação precisa da autenticação e da API do Supabase.

```bash
npx supabase@2 start                 # mostra o "API URL" e a "anon key" (ou: npx supabase@2 status)
cp .env.example .env                 # preencher com esses dois valores
docker compose up --build            # http://localhost:3000/m/demo-mesa-1
```

As variáveis `NEXT_PUBLIC_*` ficam gravadas no código do navegador durante o build, por isso
entram como build args. Se as mudar, volte a correr `docker compose up --build`.
Sem elas, o app mostra "O app ainda não está ligado à base de dados."

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
   Aplicar as migrações: `npx supabase@2 link --project-ref <ref>` e `npx supabase@2 db push`.
   Para dados de demonstração, correr `supabase/seed.sql` no SQL Editor.
2. **Vercel:** importar o repositório e definir `NEXT_PUBLIC_SUPABASE_URL` e
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
3. **Subdomínio da SIKADA:** em *Vercel → Settings → Domains* adicionar, por exemplo,
   `restaurante.sikada.<domínio>`, e no DNS do cPanel criar o registo CNAME indicado pela Vercel.

Nota: no plano gratuito, o Supabase pausa o projeto após 7 dias sem uso; basta reativá-lo no painel.

## Ainda não incluído (próxima parte do passo 2)

Divisão da conta e registo de pagamentos, livro de vendas, chat com o garçom, avaliação,
conta opcional do cliente com histórico e favoritos.
