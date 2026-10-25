-- Additive Customer column: "O que ele levou" (free text, optional).
-- Feeds the {peça} variable in 2nd-sale WhatsApp messages.
-- Existing Customer table: run this ALTER or `npx prisma db push`.
-- Do not re-run if the column already exists.

ALTER TABLE "Customer" ADD COLUMN "lastPurchasedItem" TEXT;
