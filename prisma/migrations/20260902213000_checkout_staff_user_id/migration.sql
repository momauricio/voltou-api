-- Persist the staff actor from JWT `sub` on each issued checkout.
-- Client-supplied createdBy remains human|ai and is not the actor id.

ALTER TABLE "Checkout" ADD COLUMN "staffUserId" TEXT;
