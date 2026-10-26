-- Prod parity: shipping/fulfillment status on Checkout, merchant WhatsApp
-- order alert marker, seller public key on MercadoPagoConnection, and
-- Store.slug no longer globally unique (prod only has @@unique([tenantId, slug])).
-- Production already has these columns (migration 20260723123000 / db push);
-- there, mark this migration as applied instead of running it.

-- DropIndex
DROP INDEX IF EXISTS "Store_slug_key";

-- AlterTable
ALTER TABLE "Checkout" ADD COLUMN "shippingCents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Checkout" ADD COLUMN "shippingAddressJson" TEXT;
ALTER TABLE "Checkout" ADD COLUMN "fulfillmentStatus" TEXT;
ALTER TABLE "Checkout" ADD COLUMN "orderNotifiedAt" DATETIME;

-- AlterTable
ALTER TABLE "MercadoPagoConnection" ADD COLUMN "publicKey" TEXT;
