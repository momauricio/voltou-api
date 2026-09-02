-- Store.slug must be globally unique so /loja/:storeSlug/:coupon cannot
-- resolve the wrong tenant. Deduplicate before creating the unique index.
-- Keep the earliest `principal` row (live Loja Teste /loja/principal/…).
-- Rename other `principal` rows to their tenant.slug (already unique).

UPDATE "Store"
SET "slug" = (
  SELECT "Tenant"."slug" FROM "Tenant" WHERE "Tenant"."id" = "Store"."tenantId"
)
WHERE "slug" = 'principal'
  AND "id" != (
    SELECT "id" FROM "Store"
    WHERE "slug" = 'principal'
    ORDER BY datetime("createdAt") ASC, "id" ASC
    LIMIT 1
  );

-- Remaining duplicate slugs (any value) get a stable suffix from the row id.
UPDATE "Store"
SET "slug" = "slug" || '-' || substr(replace("id", '-', ''), 1, 8)
WHERE "id" NOT IN (
  SELECT "keep_id" FROM (
    SELECT MIN("id") AS "keep_id" FROM "Store" GROUP BY "slug"
  )
);

CREATE UNIQUE INDEX "Store_slug_key" ON "Store"("slug");
