#!/bin/sh
# Baseline do Prisma Migrate para o banco de PRODUÇÃO.
#
# ATENÇÃO:
#   - Use SÓ em banco que JÁ TEM o schema completo (prod, criado/evoluído
#     por `prisma db push`). Este script NÃO executa SQL de migração: apenas
#     registra cada migração como aplicada em _prisma_migrations
#     (`prisma migrate resolve --applied`).
#   - Rode SOMENTE DEPOIS do backup do arquivo .db (ver docs/deploy-migrations.md).
#   - Em banco vazio NÃO use isto; use `npx prisma migrate deploy`.
#
# Idempotente: migração já registrada (erro P3008) é tratada como ok.
# Qualquer outro erro aborta.
set -eu

MIGRATIONS="
20260901000000_baseline
20260902120000_lojista_owner_phone_google
20260902140000_store_slug_unique
20260902213000_checkout_staff_user_id
20260902233000_store_fulfillment_settings
20260906033000_checkout_tracking_code
20261026120000_prod_parity_shipping_notify
"

echo "DATABASE_URL=${DATABASE_URL:-<não definida; Prisma lerá do .env>}"

for name in $MIGRATIONS; do
  if [ ! -f "prisma/migrations/$name/migration.sql" ]; then
    echo "ERRO: prisma/migrations/$name/migration.sql não existe." >&2
    exit 1
  fi

  echo "==> resolve --applied $name"
  if out=$(npx prisma migrate resolve --applied "$name" 2>&1); then
    echo "$out"
  else
    case "$out" in
      *P3008*)
        echo "    já registrada como aplicada (P3008), seguindo."
        ;;
      *)
        echo "$out" >&2
        echo "ERRO ao marcar $name como aplicada. Abortando." >&2
        exit 1
        ;;
    esac
  fi
done

echo "==> migrate status"
npx prisma migrate status
