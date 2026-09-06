-- Optional tracking code for home-delivery Pedidos (Checkout).
-- This repo historically applied schema with `prisma db push` (no baseline).
-- Existing Checkout table: run this SQL or `npx prisma db push`.
-- Empty database: use `npx prisma db push` (do not re-run if the columns exist).

ALTER TABLE "Checkout" ADD COLUMN "fulfillmentMethod" TEXT;
ALTER TABLE "Checkout" ADD COLUMN "trackingCode" TEXT;
