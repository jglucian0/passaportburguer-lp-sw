# Especificação Técnica: Sistema Web de Delivery & Landing Page - Passaportburguer (Multi-Tenant Ready)

## 1. Regras Rígidas de Execução (Leitura Obrigatória)

- **Execução Estrita por Camadas:** Você **NÃO** deve gerar o projeto inteiro de uma vez nem criar arquivos `.zip` completos. Construa o sistema **uma camada por vez**, seguindo rigorosamente a ordem definida na Seção 7.
- **Trava de Parada Obrigatória:** Ao concluir os arquivos da camada atual, **PARE IMEDIATAMENTE**. Liste os arquivos gerados e aguarde meu comando `"continuar"` para iniciar a próxima camada.
- **Consistência de Contratos:** Ao iniciar uma nova camada, respeite exatamente os nomes de tabelas, colunas, tipos TypeScript, schemas Zod e assinaturas de funções definidos nas camadas anteriores.
- **Modo Direto (Economia de Tokens):** Não escreva introduções, saudações, explicações teóricas ou resumos. Entregue apenas os caminhos dos arquivos e seus códigos completos.
- **Zero Testes:** Não gere arquivos de teste (`.test.ts`, `.spec.ts`) nem configurações de Vitest/Jest. Os testes serão feitos offline por mim.
- **Código Completo:** Nunca use `// ... restante do código` ou `// TODO`. Todo arquivo deve ser 100% funcional.

---

## 2. Visão Geral e Estratégia de Infraestrutura (Baixo Custo)

Construir uma aplicação web completa para a hamburgueria **PassaportBurguer** (`passaportburguer.com.br`), unindo Landing Page, Cardápio Digital com Carrinho, Painel do Cliente e Painel Administrativo (Gestor de Pedidos + CRUDs).

### Diretrizes de Custo Zero / Baixo Consumo:

1. **Hospedagem:** Vercel com Next.js App Router.
2. **Cache do Cardápio (Zero custo de banco na leitura):** A vitrine pública (`/(storefront)`) usa cache estático/ISR com `unstable_cache` e `revalidateTag('menu')`. O banco só é consultado quando o admin altera produtos/categorias.
3. **Banco de Dados:** Neon Postgres Serverless com **Drizzle ORM** (`@neondatabase/serverless` via driver HTTP para eliminar _cold starts_ pesados).
4. **Tempo Real Econômico no Admin:** Sem WebSockets externos. Implemente um endpoint leve `GET /api/admin/orders/ping` (consulta apenas `MAX(updated_at)` e `COUNT(*)` via índice) consumido a cada 15 segundos **somente** quando `document.visibilityState === 'visible'`, disparando alerta sonoro via Web Audio API quando houver novo pedido.
5. **Storage de Imagens:** Cloudflare R2 (`@aws-sdk/client-s3`) usando _Presigned URLs_ no upload. Configure `images: { unoptimized: true }` no `next.config.ts` para não consumir cota de otimização da Vercel.
6. **Arquitetura SaaS-Ready:** Todas as tabelas possuem `tenant_id` obrigatório e indexado. Hoje haverá apenas o registro inicial da `PassaportBurguer`, mas o isolamento lógico permite escalar para SaaS sem refatoração.

---

## 3. Stack Técnica Obrigatória

- **Framework:** Next.js 15 (App Router) + React 19 + TypeScript (`strict: true`)
- **Estilização:** Tailwind CSS + shadcn/ui + Lucide React (tema escuro/moderno focado em hamburgueria artesanal)
- **Banco & ORM:** PostgreSQL (Neon) + Drizzle ORM + `drizzle-kit`
- **Validação:** Zod (schemas compartilhados entre Backend e Frontend)
- **Autenticação (Stateless):** `jose` (JWT em cookies `HttpOnly`, `Secure`, `SameSite=Lax`) + `bcryptjs` (senha do admin).
- **Valores Monetários:** Armazene **todos** os valores financeiros como `integer` em centavos (ex: R$ 35,90 = `3590`).

---

## 4. Organização de Pastas (Clean Architecture Modular)

\*\*\*text
src/
├── app/
│ ├── (storefront)/ # Área pública: Landing Page, Cardápio, Carrinho, Checkout
│ │ ├── page.tsx # Hero Landing Page + Cardápio integrado
│ │ └── checkout/page.tsx # Finalização do pedido
│ ├── (customer)/ # Área do cliente final
│ │ └── meus-pedidos/page.tsx # Acompanhamento ao vivo, histórico e endereços
│ ├── (admin)/ # Área restrita da hamburgueria
│ │ └── admin/
│ │ ├── login/page.tsx
│ │ ├── page.tsx # KDS / Gestor de Pedidos em tempo real
│ │ ├── cardapio/page.tsx # CRUD Categorias, Produtos, Adicionais e Pausa Rápida
│ │ ├── entregas/page.tsx # CRUD Bairros e Taxas de Entrega
│ │ └── config/page.tsx # Horários, Pedido Mínimo, Status Aberto/Fechado
│ └── api/
│ ├── admin/orders/ping/route.ts
│ ├── upload/presigned/route.ts
│ └── webhooks/pix/route.ts
├── core/ # Regras de negócio puras (sem Next.js ou Drizzle)
│ ├── schemas/ # Schemas Zod compartilhados (pedido, cardápio, checkout)
│ ├── cart/calculate-cart.ts # Cálculo de itens, adicionais (min/max), frete e validação
│ ├── orders/state-machine.ts # Transições válidas de status do pedido
│ └── store/opening-hours.ts # Validação se a loja está aberta no horário atual
├── actions/ # Server Actions agrupadas por domínio (storefront, admin, auth)
├── infra/
│ ├── db/
│ │ ├── index.ts # Conexão Neon + Drizzle
│ │ ├── schema.ts # Definição completa das tabelas e relações
│ │ └── seed.ts # Seed inicial: Tenant PassaportBurguer + Admin + Cardápio demo
│ ├── auth/session.ts # Assinatura/verificação JWT via jose (Admin e Customer)
│ └── storage/r2.ts # Geração de Presigned URL para Cloudflare R2
├── components/
│ ├── ui/ # Componentes shadcn/ui
│ ├── storefront/ # Header, Hero, ProductCard, ProductModal, CartDrawer
│ └── admin/ # OrderBoard, OrderCard, SoundAlert, MenuForm
└── middleware.ts # Resolução de tenant (via host/env) e proteção de rotas /admin

---

---

## 5. Modelagem do Banco de Dados (`src/infra/db/schema.ts`)

Implemente as seguintes tabelas com `tenant_id` (UUID) em todas as entidades de negócio:

1. **`tenants`**: `id`, `name`, `slug` (unique), `custom_domain` (unique, nullable), `phone_whatsapp`, `logo_url`, `primary_color`, `min_order_cents`, `is_manually_closed` (boolean), `opening_hours` (JSONB: dias 0-6 com `open`, `close`, `enabled`), `created_at`.
2. **`admin_users`**: `id`, `tenant_id`, `name`, `email` (unique por tenant), `password_hash`, `role` (`OWNER` | `STAFF`), `created_at`.
3. **`categories`**: `id`, `tenant_id`, `name`, `sort_order`, `is_active`, `created_at`.
4. **`products`**: `id`, `tenant_id`, `category_id`, `name`, `description`, `price_cents`, `image_url`, `is_available` (boolean para pausa rápida), `is_featured` (boolean para destaque na landing page), `sort_order`.
5. **`addon_groups`**: `id`, `tenant_id`, `product_id`, `name`, `min_selections` (int), `max_selections` (int), `sort_order`.
6. **`addons`**: `id`, `tenant_id`, `addon_group_id`, `name`, `price_cents`, `is_available` (boolean).
7. **`delivery_zones`**: `id`, `tenant_id`, `neighborhood`, `fee_cents`, `estimated_minutes`, `is_active`.
8. **`customers`**: `id`, `tenant_id`, `name`, `phone` (unique por tenant, apenas dígitos), `created_at`.
9. **`customer_addresses`**: `id`, `tenant_id`, `customer_id`, `delivery_zone_id`, `street`, `number`, `complement`, `reference`.
10. **`orders`**: `id`, `tenant_id`, `customer_id`, `order_number` (sequencial legível por tenant, ex: `#101`), `status` (`AWAITING_PAYMENT` | `RECEIVED` | `PREPARING` | `OUT_FOR_DELIVERY` | `DELIVERED` | `CANCELED`), `delivery_type` (`DELIVERY` | `PICKUP`), `address_snapshot` (JSONB imutável), `payment_method` (`PIX` | `CARD_ON_DELIVERY` | `CASH`), `change_for_cents` (nullable), `subtotal_cents`, `delivery_fee_cents`, `total_cents`, `notes`, `cancel_reason`, `created_at`, `updated_at`.
11. **`order_items`**: `id`, `tenant_id`, `order_id`, `product_id` (nullable FK), `product_name_snapshot`, `unit_price_cents_snapshot`, `quantity`, `addons_snapshot` (JSONB: `[{ name, price_cents, quantity }]`), `total_item_cents`.

---

## 6. Regras de Negócio e Fluxos Críticos

- **Storefront & Carrinho:** Mobile-First (360px–430px). Modal exige validação de `min_selections` e `max_selections`. Carrinho persistido em `localStorage` por `tenant_id`.
- **Checkout:** _Guest Checkout_ (Nome + WhatsApp + Entrega/Retirada + Bairro/Endereço + Pagamento). A Server Action recalcula **todos os preços no backend**, valida horário e pedido mínimo, cria/atualiza `customer` pelo telefone, grava snapshots imutáveis e define cookie `customer_token` redirecionando para `/meus-pedidos`.
- **Painel do Cliente (`/meus-pedidos`):** Lê `customer_token` (ou consulta por WhatsApp se sem cookie) e exibe pedido ativo com barra de progresso + histórico com botão "Pedir Novamente".
- **Painel Admin (`/admin`):** Gestor de pedidos por status com alerta sonoro, CRUD de cardápio/adicionais com _Switch_ de pausa rápida (`revalidateTag('menu')`), CRUD de bairros, botão "Fechar Loja Agora" e horários.

---

## 7. Ordem de Execução das 5 Camadas (Bottom-Up)

1. **Camada 1 — Infraestrutura & Banco de Dados:**
   - `package.json`, `next.config.ts`, `drizzle.config.ts`, `.env.example`
   - `src/infra/db/schema.ts`, `src/infra/db/index.ts`, `src/infra/db/seed.ts`
   - `src/infra/auth/session.ts`, `src/infra/storage/r2.ts`, `src/middleware.ts`
2. **Camada 2 — Core de Negócio Puro:**
   - `src/core/schemas/*.ts` (schemas Zod de produto, carrinho, checkout, admin)
   - `src/core/cart/calculate-cart.ts`
   - `src/core/orders/state-machine.ts`
   - `src/core/store/opening-hours.ts`
3. **Camada 3 — Backend (Server Actions & Route Handlers):**
   - `src/actions/storefront.ts` (leitura cacheada do cardápio com `revalidateTag('menu')`, criação de pedido, busca de pedidos do cliente)
   - `src/actions/auth.ts` (login/logout admin)
   - `src/actions/admin.ts` (avançar/cancelar pedido, CRUD cardápio/adicionais + pausa rápida, CRUD bairros, configs da loja)
   - `src/app/api/admin/orders/ping/route.ts`, `src/app/api/upload/presigned/route.ts`, `src/app/api/webhooks/pix/route.ts`
4. **Camada 4 — Frontend Público & Cliente:**
   - `src/app/layout.tsx`, `src/app/globals.css` e componentes `src/components/storefront/*`
   - `src/app/(storefront)/page.tsx` e `src/app/(storefront)/checkout/page.tsx`
   - `src/app/(customer)/meus-pedidos/page.tsx`
5. **Camada 5 — Frontend Administrativo:**
   - Componentes `src/components/admin/*` (OrderBoard, SoundAlert, MenuForm, etc.)
   - `src/app/(admin)/admin/login/page.tsx`, `page.tsx`, `cardapio/page.tsx`, `entregas/page.tsx`, `config/page.tsx`

---

**Inicie agora construindo APENAS a Camada 1 (Infraestrutura & Banco de Dados) e pare ao final.**
