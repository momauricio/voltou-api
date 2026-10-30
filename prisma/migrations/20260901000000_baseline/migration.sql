-- Baseline: schema completo ANTES das migrações versionadas (estado de
-- `a237dc0^:prisma/schema.prisma`). Gerado com:
--   prisma migrate diff --from-empty \
--     --to-schema-datamodel <schema de a237dc0^> --script
--
-- Até aqui o banco era criado/evoluído só com `prisma db push`, sem
-- migração inicial. Este arquivo existe para que `prisma migrate deploy`
-- funcione num banco VAZIO (dev/CI/novo ambiente).
--
-- Em bancos EXISTENTES (produção, criada por db push) esta migração é
-- marcada com `prisma migrate resolve --applied 20260901000000_baseline`
-- e NUNCA é executada. Ver docs/deploy-migrations.md.
--
-- Não edite: o checksum deste arquivo fica registrado em _prisma_migrations.

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "cnpj" TEXT NOT NULL,
    "commissionRateBps" INTEGER NOT NULL DEFAULT 500,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Store" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    "preferredCheckoutProvider" TEXT NOT NULL DEFAULT 'mercadopago',
    "checkoutLogoUrl" TEXT,
    "checkoutPrimaryColor" TEXT,
    "checkoutSecondaryColor" TEXT,
    "checkoutFontFamily" TEXT,
    "checkoutMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Store_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "ownerName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'owner',
    "emailVerifiedAt" DATETIME,
    "emailVerifyToken" TEXT,
    "passwordResetToken" TEXT,
    "passwordResetExpires" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "User_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT,
    "blingProductId" TEXT,
    "category" TEXT,
    "priceCents" INTEGER NOT NULL,
    "costCents" INTEGER,
    "maxDiscountBps" INTEGER,
    "availability" TEXT NOT NULL DEFAULT 'available',
    "sellableByAi" BOOLEAN NOT NULL DEFAULT true,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Product_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Product_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "phoneHash" TEXT NOT NULL,
    "phoneEnc" TEXT,
    "phoneMasked" TEXT,
    "notes" TEXT,
    "optedOutAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Customer_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Customer_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CustomerInterest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "productId" TEXT,
    "productNameSnapshot" TEXT NOT NULL,
    "productPriceCents" INTEGER,
    "source" TEXT NOT NULL DEFAULT 'walk_in',
    "status" TEXT NOT NULL DEFAULT 'open',
    "notes" TEXT,
    "interestedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CustomerInterest_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CustomerInterest_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CustomerInterest_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CustomerInterest_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Sale" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "source" TEXT NOT NULL DEFAULT 'in_store',
    "status" TEXT NOT NULL DEFAULT 'completed',
    "checkoutId" TEXT,
    "commissionCents" INTEGER NOT NULL DEFAULT 0,
    "commissionRateBps" INTEGER NOT NULL DEFAULT 0,
    "mpPaymentId" TEXT,
    "soldAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Sale_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Sale_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Sale_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Sale_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Sale_checkoutId_fkey" FOREIGN KEY ("checkoutId") REFERENCES "Checkout" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Checkout" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "productId" TEXT,
    "productNameSnapshot" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "paymentUrl" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'stub',
    "externalId" TEXT,
    "couponCode" TEXT,
    "listPriceCents" INTEGER,
    "discountBps" INTEGER NOT NULL DEFAULT 0,
    "clickedAt" DATETIME,
    "clickCount" INTEGER NOT NULL DEFAULT 0,
    "outreachMessageId" TEXT,
    "mpPaymentId" TEXT,
    "providerRef" TEXT,
    "providerInitPoint" TEXT,
    "commissionRateBps" INTEGER NOT NULL,
    "commissionCents" INTEGER NOT NULL DEFAULT 0,
    "interestId" TEXT,
    "createdBy" TEXT NOT NULL DEFAULT 'human',
    "paidAt" DATETIME,
    "expiresAt" DATETIME,
    "reminderAt" DATETIME,
    "addonsJson" TEXT,
    "paidLinesJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Checkout_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Checkout_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Checkout_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Checkout_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WebhookLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "provider" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "headers" TEXT,
    "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedOk" BOOLEAN NOT NULL DEFAULT false,
    "error" TEXT
);

-- CreateTable
CREATE TABLE "CustomerEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "metadata" TEXT,
    "occurredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CustomerEvent_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CustomerEvent_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CustomerEvent_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "segment" TEXT,
    "messageTemplate" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'manual',
    "scheduledAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Campaign_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Campaign_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OutreachMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'whatsapp',
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending_approval',
    "failReason" TEXT,
    "externalChatId" TEXT,
    "providerMessageId" TEXT,
    "approvedAt" DATETIME,
    "sentAt" DATETIME,
    "repliedAt" DATETIME,
    "replyPreview" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OutreachMessage_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OutreachMessage_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OutreachMessage_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OutreachMessage_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StoreKnowledge" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "StoreKnowledge_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StoreKnowledge_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ImportJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'preview',
    "fileName" TEXT,
    "payload" TEXT NOT NULL,
    "customersCount" INTEGER NOT NULL DEFAULT 0,
    "productsCount" INTEGER NOT NULL DEFAULT 0,
    "salesCount" INTEGER NOT NULL DEFAULT 0,
    "errors" TEXT,
    "committedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ImportJob_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ImportJob_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WhatsAppConnection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sessionName" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'waha',
    "status" TEXT NOT NULL DEFAULT 'STARTING',
    "phoneE164" TEXT,
    "metadataEnc" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WhatsAppConnection_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WhatsAppConnection_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BlingConnection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "accessTokenEnc" TEXT NOT NULL,
    "refreshTokenEnc" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'connected',
    "accountLabel" TEXT,
    "lastSyncAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BlingConnection_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BlingConnection_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MercadoPagoConnection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenantId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "accessTokenEnc" TEXT NOT NULL,
    "refreshTokenEnc" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'connected',
    "mpUserId" TEXT,
    "accountLabel" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MercadoPagoConnection_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MercadoPagoConnection_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_slug_key" ON "Tenant"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_cnpj_key" ON "Tenant"("cnpj");

-- CreateIndex
CREATE INDEX "Store_tenantId_idx" ON "Store"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Store_tenantId_slug_key" ON "Store"("tenantId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_tenantId_idx" ON "User"("tenantId");

-- CreateIndex
CREATE INDEX "User_emailVerifyToken_idx" ON "User"("emailVerifyToken");

-- CreateIndex
CREATE INDEX "User_passwordResetToken_idx" ON "User"("passwordResetToken");

-- CreateIndex
CREATE INDEX "Product_tenantId_storeId_idx" ON "Product"("tenantId", "storeId");

-- CreateIndex
CREATE INDEX "Product_tenantId_storeId_blingProductId_idx" ON "Product"("tenantId", "storeId", "blingProductId");

-- CreateIndex
CREATE INDEX "Product_tenantId_storeId_sku_idx" ON "Product"("tenantId", "storeId", "sku");

-- CreateIndex
CREATE INDEX "Customer_tenantId_storeId_idx" ON "Customer"("tenantId", "storeId");

-- CreateIndex
CREATE INDEX "Customer_phoneHash_idx" ON "Customer"("phoneHash");

-- CreateIndex
CREATE INDEX "CustomerInterest_tenantId_storeId_customerId_idx" ON "CustomerInterest"("tenantId", "storeId", "customerId");

-- CreateIndex
CREATE INDEX "CustomerInterest_tenantId_status_idx" ON "CustomerInterest"("tenantId", "status");

-- CreateIndex
CREATE INDEX "CustomerInterest_productId_idx" ON "CustomerInterest"("productId");

-- CreateIndex
CREATE INDEX "Sale_tenantId_storeId_soldAt_idx" ON "Sale"("tenantId", "storeId", "soldAt");

-- CreateIndex
CREATE INDEX "Sale_customerId_idx" ON "Sale"("customerId");

-- CreateIndex
CREATE INDEX "Sale_mpPaymentId_idx" ON "Sale"("mpPaymentId");

-- CreateIndex
CREATE INDEX "Sale_checkoutId_idx" ON "Sale"("checkoutId");

-- CreateIndex
CREATE INDEX "Checkout_tenantId_storeId_status_idx" ON "Checkout"("tenantId", "storeId", "status");

-- CreateIndex
CREATE INDEX "Checkout_customerId_idx" ON "Checkout"("customerId");

-- CreateIndex
CREATE INDEX "Checkout_externalId_idx" ON "Checkout"("externalId");

-- CreateIndex
CREATE INDEX "Checkout_providerRef_idx" ON "Checkout"("providerRef");

-- CreateIndex
CREATE INDEX "Checkout_couponCode_idx" ON "Checkout"("couponCode");

-- CreateIndex
CREATE UNIQUE INDEX "Checkout_storeId_couponCode_key" ON "Checkout"("storeId", "couponCode");

-- CreateIndex
CREATE INDEX "CustomerEvent_tenantId_customerId_occurredAt_idx" ON "CustomerEvent"("tenantId", "customerId", "occurredAt");

-- CreateIndex
CREATE INDEX "Campaign_tenantId_storeId_idx" ON "Campaign"("tenantId", "storeId");

-- CreateIndex
CREATE INDEX "OutreachMessage_tenantId_storeId_status_idx" ON "OutreachMessage"("tenantId", "storeId", "status");

-- CreateIndex
CREATE INDEX "OutreachMessage_externalChatId_idx" ON "OutreachMessage"("externalChatId");

-- CreateIndex
CREATE INDEX "StoreKnowledge_tenantId_storeId_idx" ON "StoreKnowledge"("tenantId", "storeId");

-- CreateIndex
CREATE INDEX "ImportJob_tenantId_storeId_createdAt_idx" ON "ImportJob"("tenantId", "storeId", "createdAt");

-- CreateIndex
CREATE INDEX "WhatsAppConnection_tenantId_storeId_idx" ON "WhatsAppConnection"("tenantId", "storeId");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppConnection_sessionName_key" ON "WhatsAppConnection"("sessionName");

-- CreateIndex
CREATE INDEX "BlingConnection_tenantId_storeId_idx" ON "BlingConnection"("tenantId", "storeId");

-- CreateIndex
CREATE UNIQUE INDEX "BlingConnection_tenantId_storeId_key" ON "BlingConnection"("tenantId", "storeId");

-- CreateIndex
CREATE INDEX "MercadoPagoConnection_tenantId_storeId_idx" ON "MercadoPagoConnection"("tenantId", "storeId");

-- CreateIndex
CREATE UNIQUE INDEX "MercadoPagoConnection_tenantId_storeId_key" ON "MercadoPagoConnection"("tenantId", "storeId");

