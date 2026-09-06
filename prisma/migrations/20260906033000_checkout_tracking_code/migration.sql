-- Additive Checkout columns for Pedidos tracking (home delivery).
-- Existing Checkout table: run this ALTER or `npx prisma db push`.
-- Do not re-run if the columns already exist.

ALTER TABLE "Checkout" ADD COLUMN "fulfillmentMethod" TEXT;
ALTER TABLE "Checkout" ADD COLUMN "trackingCode" TEXT;
