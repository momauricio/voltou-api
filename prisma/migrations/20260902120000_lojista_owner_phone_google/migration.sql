-- AlterTable: lojista WhatsApp identity + Google subject
ALTER TABLE "User" ADD COLUMN "ownerPhoneE164" TEXT;
ALTER TABLE "User" ADD COLUMN "googleSub" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_ownerPhoneE164_key" ON "User"("ownerPhoneE164");
CREATE UNIQUE INDEX "User_googleSub_key" ON "User"("googleSub");
