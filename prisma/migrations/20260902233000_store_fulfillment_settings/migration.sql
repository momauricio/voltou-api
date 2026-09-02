-- Store fulfillment overlay: pickup address + order-alert WhatsApp.
-- Required on PATCH /stores/fulfillment; nullable here so existing rows boot.

ALTER TABLE "Store" ADD COLUMN "deliveryEnabled" BOOLEAN NOT NULL DEFAULT 1;
ALTER TABLE "Store" ADD COLUMN "shippingCents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Store" ADD COLUMN "pickupAddressText" TEXT;
ALTER TABLE "Store" ADD COLUMN "orderNotifyPhoneE164" TEXT;
