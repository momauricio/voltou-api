-- Additive SQLite change on User.
-- This repo historically applied schema with `prisma db push` (no baseline migration).
-- Existing User table without these columns: run this SQL or `npx prisma db push`.
-- Empty database: use `npx prisma db push` to create the full schema (do not run this
-- ALTER on a DB that has no User table, and do not re-run it if the columns exist).

ALTER TABLE "User" ADD COLUMN "ownerPhoneE164" TEXT;
ALTER TABLE "User" ADD COLUMN "googleSub" TEXT;

CREATE UNIQUE INDEX "User_ownerPhoneE164_key" ON "User"("ownerPhoneE164");
CREATE UNIQUE INDEX "User_googleSub_key" ON "User"("googleSub");
