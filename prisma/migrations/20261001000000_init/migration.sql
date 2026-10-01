-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shop" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "moneyFormat" TEXT,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "importStatus" TEXT NOT NULL DEFAULT 'idle',
    "importKind" TEXT,
    "importBulkId" TEXT,
    "importError" TEXT,
    "importedAt" TIMESTAMP(3),
    "historyFrom" TIMESTAMP(3),
    "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uninstalledAt" TIMESTAMP(3),

    CONSTRAINT "Shop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "shop" TEXT NOT NULL,
    "id" BIGINT NOT NULL,
    "title" TEXT NOT NULL,
    "vendor" TEXT,
    "productType" TEXT,
    "tags" TEXT[],
    "collections" BIGINT[],
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("shop","id")
);

-- CreateTable
CREATE TABLE "Variant" (
    "shop" TEXT NOT NULL,
    "id" BIGINT NOT NULL,
    "productId" BIGINT NOT NULL,
    "title" TEXT,
    "sku" TEXT,
    "inventoryItemId" BIGINT,
    "shopifyCostCents" INTEGER,
    "weightGrams" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Variant_pkey" PRIMARY KEY ("shop","id")
);

-- CreateTable
CREATE TABLE "VariantCost" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "variantId" BIGINT NOT NULL,
    "costCents" INTEGER NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VariantCost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "shop" TEXT NOT NULL,
    "id" BIGINT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL,
    "day" DATE NOT NULL,
    "test" BOOLEAN NOT NULL DEFAULT false,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "financialStatus" TEXT,
    "fulfillmentStatus" TEXT,
    "returnStatus" TEXT,
    "outcome" TEXT NOT NULL,
    "channel" TEXT,
    "gateways" TEXT[],
    "isCod" BOOLEAN NOT NULL DEFAULT false,
    "countryCode" TEXT,
    "province" TEXT,
    "provinceCode" TEXT,
    "city" TEXT,
    "zip" TEXT,
    "zoneId" TEXT,
    "carrier" TEXT,
    "weightGrams" INTEGER NOT NULL DEFAULT 0,
    "itemCount" INTEGER NOT NULL DEFAULT 0,
    "customerHash" TEXT,
    "customerOrderIndex" INTEGER,
    "grossSalesCents" INTEGER NOT NULL DEFAULT 0,
    "discountsCents" INTEGER NOT NULL DEFAULT 0,
    "returnsCents" INTEGER NOT NULL DEFAULT 0,
    "shippingChargedCents" INTEGER NOT NULL DEFAULT 0,
    "shippingRefundCents" INTEGER NOT NULL DEFAULT 0,
    "taxesCents" INTEGER NOT NULL DEFAULT 0,
    "totalCents" INTEGER NOT NULL DEFAULT 0,
    "refundedCents" INTEGER NOT NULL DEFAULT 0,
    "shopifyFeesCents" INTEGER,
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "utmCampaign" TEXT,
    "utmContent" TEXT,
    "utmTerm" TEXT,
    "landingPage" TEXT,
    "referrer" TEXT,
    "fbclid" TEXT,
    "gclid" TEXT,
    "ttclid" TEXT,
    "adPlatform" TEXT,
    "adCampaignId" TEXT,
    "adSetId" TEXT,
    "adId" TEXT,
    "attribution" TEXT,
    "revenueCents" INTEGER NOT NULL DEFAULT 0,
    "cogsCents" INTEGER NOT NULL DEFAULT 0,
    "shippingCents" INTEGER NOT NULL DEFAULT 0,
    "feesCents" INTEGER NOT NULL DEFAULT 0,
    "adCents" INTEGER NOT NULL DEFAULT 0,
    "otherCents" INTEGER NOT NULL DEFAULT 0,
    "profitCents" INTEGER NOT NULL DEFAULT 0,
    "missingCost" BOOLEAN NOT NULL DEFAULT false,
    "computedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("shop","id")
);

-- CreateTable
CREATE TABLE "OrderLine" (
    "shop" TEXT NOT NULL,
    "id" BIGINT NOT NULL,
    "orderId" BIGINT NOT NULL,
    "productId" BIGINT,
    "variantId" BIGINT,
    "title" TEXT NOT NULL,
    "variantTitle" TEXT,
    "sku" TEXT,
    "quantity" INTEGER NOT NULL,
    "refundedQty" INTEGER NOT NULL DEFAULT 0,
    "restockedQty" INTEGER NOT NULL DEFAULT 0,
    "unitPriceCents" INTEGER NOT NULL,
    "discountCents" INTEGER NOT NULL DEFAULT 0,
    "unitCostCents" INTEGER,
    "weightGrams" INTEGER,

    CONSTRAINT "OrderLine_pkey" PRIMARY KEY ("shop","id")
);

-- CreateTable
CREATE TABLE "OrderCost" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "orderId" BIGINT NOT NULL,
    "type" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "refId" TEXT,
    "note" TEXT,

    CONSTRAINT "OrderCost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShippingZone" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "province" TEXT,
    "city" TEXT,
    "label" TEXT NOT NULL,
    "orderCount" INTEGER NOT NULL DEFAULT 0,
    "configured" BOOLEAN NOT NULL DEFAULT false,
    "deliveryCents" INTEGER,
    "perItemCents" INTEGER,
    "perKgCents" INTEGER,
    "returnCents" INTEGER,
    "codFeePct" DECIMAL(6,3),
    "codFeeCents" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShippingZone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdAccount" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT,
    "currency" TEXT,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'active',
    "lastError" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdInsightDaily" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "campaignId" TEXT NOT NULL,
    "campaignName" TEXT,
    "adSetId" TEXT,
    "adSetName" TEXT,
    "adId" TEXT NOT NULL,
    "adName" TEXT,
    "currency" TEXT NOT NULL,
    "spendCents" INTEGER NOT NULL,
    "spendShopCents" INTEGER NOT NULL,
    "fxRate" DECIMAL(18,8) NOT NULL,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "purchases" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "purchaseValueCents" INTEGER NOT NULL DEFAULT 0,
    "raw" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdInsightDaily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostRule" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "template" TEXT,
    "kind" TEXT NOT NULL,
    "amount" DECIMAL(14,4) NOT NULL,
    "period" TEXT,
    "distribute" TEXT,
    "startsOn" DATE,
    "endsOn" DATE,
    "filters" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CostRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FxRate" (
    "date" DATE NOT NULL,
    "base" TEXT NOT NULL,
    "quote" TEXT NOT NULL,
    "rate" DECIMAL(18,8) NOT NULL,

    CONSTRAINT "FxRate_pkey" PRIMARY KEY ("date","base","quote")
);

-- CreateTable
CREATE TABLE "SyncLog" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "message" TEXT,
    "stats" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "SyncLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL,
    "ownerShop" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "reportCurrency" TEXT NOT NULL DEFAULT 'USD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceStore" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "label" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "model" JSONB NOT NULL DEFAULT '[{"kind":"own"}]',
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "WorkspaceStore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LinkCode" (
    "code" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "usedBy" TEXT,

    CONSTRAINT "LinkCode_pkey" PRIMARY KEY ("code")
);

-- CreateIndex
CREATE INDEX "Variant_shop_inventoryItemId_idx" ON "Variant"("shop", "inventoryItemId");

-- CreateIndex
CREATE INDEX "VariantCost_shop_variantId_effectiveFrom_idx" ON "VariantCost"("shop", "variantId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "Order_shop_day_idx" ON "Order"("shop", "day");

-- CreateIndex
CREATE INDEX "Order_shop_zoneId_idx" ON "Order"("shop", "zoneId");

-- CreateIndex
CREATE INDEX "Order_shop_adPlatform_day_idx" ON "Order"("shop", "adPlatform", "day");

-- CreateIndex
CREATE INDEX "OrderLine_shop_orderId_idx" ON "OrderLine"("shop", "orderId");

-- CreateIndex
CREATE INDEX "OrderLine_shop_variantId_idx" ON "OrderLine"("shop", "variantId");

-- CreateIndex
CREATE INDEX "OrderCost_shop_orderId_idx" ON "OrderCost"("shop", "orderId");

-- CreateIndex
CREATE INDEX "OrderCost_shop_type_idx" ON "OrderCost"("shop", "type");

-- CreateIndex
CREATE UNIQUE INDEX "ShippingZone_shop_key_key" ON "ShippingZone"("shop", "key");

-- CreateIndex
CREATE UNIQUE INDEX "AdAccount_shop_platform_externalId_key" ON "AdAccount"("shop", "platform", "externalId");

-- CreateIndex
CREATE INDEX "AdInsightDaily_shop_date_idx" ON "AdInsightDaily"("shop", "date");

-- CreateIndex
CREATE UNIQUE INDEX "AdInsightDaily_shop_platform_date_adId_key" ON "AdInsightDaily"("shop", "platform", "date", "adId");

-- CreateIndex
CREATE INDEX "CostRule_shop_idx" ON "CostRule"("shop");

-- CreateIndex
CREATE INDEX "SyncLog_shop_kind_startedAt_idx" ON "SyncLog"("shop", "kind", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_ownerShop_key" ON "Workspace"("ownerShop");

-- CreateIndex
CREATE INDEX "WorkspaceStore_shop_idx" ON "WorkspaceStore"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceStore_workspaceId_shop_key" ON "WorkspaceStore"("workspaceId", "shop");

-- AddForeignKey
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_shop_orderId_fkey" FOREIGN KEY ("shop", "orderId") REFERENCES "Order"("shop", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderCost" ADD CONSTRAINT "OrderCost_shop_orderId_fkey" FOREIGN KEY ("shop", "orderId") REFERENCES "Order"("shop", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceStore" ADD CONSTRAINT "WorkspaceStore_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

