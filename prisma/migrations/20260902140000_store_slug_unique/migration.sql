-- Store.slug must be globally unique so /loja/:storeSlug/:coupon cannot
-- resolve the wrong tenant.
--
-- Keep the earliest `principal` row (live Loja Teste /loja/principal/…)
-- and never rename that id in later passes.
-- Other duplicate `principal` rows are renamed to tenant.slug when that
-- value is free; otherwise they get a suffix from the row uuid.
--
-- This repo historically applied schema with `prisma db push`.
-- `db push` will NOT run this SQL. If Store.slug values are duplicated,
-- run this script (or `npx prisma migrate deploy`) BEFORE the unique
-- index. Empty database: `prisma db push` from schema.prisma is enough.

CREATE TEMP TABLE "_store_slug_keep" ("id" TEXT PRIMARY KEY);

INSERT INTO "_store_slug_keep" ("id")
SELECT "id" FROM "Store"
WHERE "slug" = 'principal'
ORDER BY datetime("createdAt") ASC, "id" ASC
LIMIT 1;

INSERT INTO "_store_slug_keep" ("id")
SELECT MIN("id") FROM "Store"
WHERE "slug" != 'principal'
  AND "id" NOT IN (SELECT "id" FROM "_store_slug_keep")
GROUP BY "slug";

UPDATE "Store"
SET "slug" = COALESCE(
  (
    SELECT
      CASE
        WHEN t."slug" IS NOT NULL
          AND t."slug" != "Store"."slug"
          AND NOT EXISTS (
            SELECT 1
            FROM "Store" kept
            INNER JOIN "_store_slug_keep" k ON k."id" = kept."id"
            WHERE kept."slug" = t."slug"
          )
        THEN t."slug"
        ELSE "Store"."slug" || '-' || replace("Store"."id", '-', '')
      END
    FROM "Tenant" t
    WHERE t."id" = "Store"."tenantId"
  ),
  "slug" || '-' || replace("id", '-', '')
)
WHERE "id" NOT IN (SELECT "id" FROM "_store_slug_keep");

DROP TABLE "_store_slug_keep";

CREATE UNIQUE INDEX "Store_slug_key" ON "Store"("slug");
