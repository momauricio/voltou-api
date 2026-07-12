# Voltou API

Backend NestJS do Voltou: multi-tenant, vendas, campanhas e integracao WhatsApp (BSP).

Frontend em repositorio separado: `../voltou-web`.

## Estrutura

- `src/` — modulos Nest (auth, tenants, stores, products, sales, campaigns, agent, whatsapp)
- `src/prisma/` — `PrismaModule` global e `PrismaService` (cliente PostgreSQL)
- `src/shared/` — schemas Zod compartilhados (validacao de entrada)
- `prisma/schema.prisma` — modelo de dados (tenants, lojas, PII com hash/criptografia na aplicacao)
- `src/whatsapp/` — adaptador BSP (`WhatsAppProvider`); implementacao stub para desenvolvimento

## Multi-tenant

Todas as entidades de negocio carregam `tenantId` (e em geral `storeId`). Consulte `.cursor/rules/multi-tenant.mdc` e `security-lgpd.mdc`.

## Como rodar

```bash
cp .env.example .env
npm install
npx prisma generate
npm run start:dev
```

API na porta **3001** (variavel `PORT` opcional).

### Banco de dados

```bash
npm run db:push
# ou
npm run db:migrate
```

## Build

```bash
npm run build
```