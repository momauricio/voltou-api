# Voltou API

Backend NestJS do Voltou: multi-tenant, vendas, campanhas e integração WhatsApp via [WAHA](https://waha.devlike.pro/).

Frontend em repositório separado: `../voltou-web`.

## Estrutura

- `src/` — módulos Nest (auth, tenants, stores, products, sales, campaigns, agent, whatsapp)
- `src/prisma/` — `PrismaModule` global e `PrismaService`
- `src/shared/` — schemas Zod compartilhados
- `prisma/schema.prisma` — modelo de dados
- `src/whatsapp/` — adaptador `WhatsAppProvider` (stub ou WAHA via `WAHA_BASE_URL`)

## Multi-tenant

Todas as entidades de negócio carregam `tenantId` (e em geral `storeId`). Consulte `.cursor/rules/multi-tenant.mdc` e `security-lgpd.mdc`.

## Como rodar

```bash
cp .env.example .env
# AUTH_SECRET is required. The old default voltou-dev-secret-change-me is refused.
# openssl rand -base64 48
npm install
npx prisma generate
npm run start:dev
```

API na porta **3001** (variável `PORT` opcional).

### Banco de dados

```bash
npm run db:push
# ou
npm run db:migrate
```

### WhatsApp (WAHA)

1. Gere credenciais do WAHA (uma vez):

```bash
mkdir -p waha
docker run --rm -v "${PWD}/waha:/app/env" devlikeapro/waha init-waha /app/env
```

2. Suba o container (porta **3002**):

```bash
docker compose -f docker-compose.waha.yml up -d
```

3. Copie `WAHA_API_KEY` de `waha/.env` para o `.env` da API e confirme:

```env
WAHA_BASE_URL=http://localhost:3002
WAHA_API_KEY=<sua-chave>
```

4. No painel (`/painel/whatsapp`), clique em **Conectar WhatsApp**, escaneie o QR no celular.

Dashboard WAHA: http://localhost:3002/dashboard

Sem `WAHA_BASE_URL`, o módulo usa o provedor stub (útil só para smoke tests sem Docker).

### Bling (produtos + estoque)

1. Cadastre um app em https://developer.bling.com.br com redirect URI igual a `BLING_REDIRECT_URI` e escopos de **produtos** e **estoques**.
2. No `.env` da API:

```env
BLING_CLIENT_ID=<client-id>
BLING_CLIENT_SECRET=<client-secret>
BLING_REDIRECT_URI=http://localhost:3000/painel/produtos/bling/callback
```

3. No painel (`/painel/produtos`), use o card **Estoque e catálogo via Bling** → Conectar → Sincronizar.

Sem as envs do Bling, a API responde 503 claro ao tentar conectar.

### Mercado Pago (checkout com split / comissão)

1. Crie um app **Marketplace** em https://www.mercadopago.com.br/developers (Split 1:1).
2. Configure redirect e notificação:
   - Redirect: `MP_REDIRECT_URI` (ex.: `http://localhost:3000/painel/perfil/mercadopago/callback`)
   - Webhook: `{API_PUBLIC_URL}/mercadopago/webhook`
3. No `.env` da API:

```env
MP_CLIENT_ID=<client-id>
MP_CLIENT_SECRET=<client-secret>
MP_REDIRECT_URI=http://localhost:3000/painel/perfil/mercadopago/callback
API_PUBLIC_URL=http://localhost:3001
WEB_URL=http://localhost:3000
MP_USE_SANDBOX=1
```

4. No painel (`/painel/perfil`), card **Pagamentos e comissão** → Conectar Mercado Pago.
5. Checkouts geram `/p/{token}` no web; com MP conectado, a Preference inclui `marketplace_fee` = comissão Voltou (`Tenant.commissionRateBps`).

Sem as envs do MP, OAuth retorna 503 e o checkout fica em modo stub (sem `init_point`).

## Build

```bash
npm run build
```
