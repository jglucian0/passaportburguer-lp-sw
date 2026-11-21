# Deploy na Cloudflare (Workers + OpenNext)

1. `npx wrangler login`
2. `npx wrangler r2 bucket create passaportburguer-cache`
3. Variáveis públicas/build: crie `.env.production` (ou use as do ambiente) — as `NEXT_PUBLIC_*` entram no build.
4. Segredos (uma vez): para cada env sensível: `npx wrangler secret put NOME` (DATABASE_URL, CRON_SECRET, ASAAS_*, WHATSAPP_*, META_CAPI_TOKEN, ...).
5. `APP_URL` (ex.: https://passaportburguer.<conta>.workers.dev) como var em `wrangler.jsonc` > `vars`.
6. `npx opennextjs-cloudflare build && npx wrangler deploy`
7. Teste na URL .workers.dev; só depois aponte o domínio (Workers > Settings > Domains).
Preview local: `npx opennextjs-cloudflare preview`.
