-- CreateEnum
CREATE TYPE "MatchMethod" AS ENUM ('EAN', 'EXACT', 'FUZZY', 'AI', 'MANUAL', 'NEW');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('RUNNING', 'OK', 'PARTIAL', 'FAILED', 'SUSPECT');

-- CreateTable
CREATE TABLE "Store" (
    "id" SERIAL NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Store_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" SERIAL NOT NULL,
    "ean" TEXT,
    "brand" TEXT,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "quantityValue" DECIMAL(65,30),
    "quantityUnit" TEXT,
    "categoryId" INTEGER,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreOffer" (
    "id" SERIAL NOT NULL,
    "storeId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "externalId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "imageUrl" TEXT,
    "categoryPath" TEXT,
    "available" BOOLEAN NOT NULL,
    "currentPriceCents" INTEGER NOT NULL,
    "currentPromoPriceCents" INTEGER,
    "currentPromoType" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "matchMethod" "MatchMethod" NOT NULL,
    "matchConfidence" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "StoreOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PricePoint" (
    "id" SERIAL NOT NULL,
    "offerId" INTEGER NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "promoPriceCents" INTEGER,
    "promoType" TEXT,
    "capturedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PricePoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" SERIAL NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" INTEGER,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreCategoryMap" (
    "storeId" INTEGER NOT NULL,
    "externalPath" TEXT NOT NULL,
    "categoryId" INTEGER NOT NULL,

    CONSTRAINT "StoreCategoryMap_pkey" PRIMARY KEY ("storeId","externalPath")
);

-- CreateTable
CREATE TABLE "ScrapeRun" (
    "id" SERIAL NOT NULL,
    "storeId" INTEGER NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "offersSeen" INTEGER NOT NULL DEFAULT 0,
    "offersChanged" INTEGER NOT NULL DEFAULT 0,
    "newOffers" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "meta" JSONB,

    CONSTRAINT "ScrapeRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StagingOffer" (
    "id" SERIAL NOT NULL,
    "runId" INTEGER NOT NULL,
    "externalId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,

    CONSTRAINT "StagingOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShoppingList" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "ShoppingList_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShoppingListItem" (
    "id" SERIAL NOT NULL,
    "listId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ShoppingListItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceAlert" (
    "id" SERIAL NOT NULL,
    "productId" INTEGER NOT NULL,
    "targetPriceCents" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "PriceAlert_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Store_slug_key" ON "Store"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Product_ean_key" ON "Product"("ean");

-- CreateIndex
CREATE INDEX "Product_normalizedName_idx" ON "Product"("normalizedName");

-- CreateIndex
CREATE INDEX "StoreOffer_productId_idx" ON "StoreOffer"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "StoreOffer_storeId_externalId_key" ON "StoreOffer"("storeId", "externalId");

-- CreateIndex
CREATE INDEX "PricePoint_offerId_capturedAt_idx" ON "PricePoint"("offerId", "capturedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Category_slug_key" ON "Category"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "StagingOffer_runId_externalId_key" ON "StagingOffer"("runId", "externalId");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreOffer" ADD CONSTRAINT "StoreOffer_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreOffer" ADD CONSTRAINT "StoreOffer_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PricePoint" ADD CONSTRAINT "PricePoint_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "StoreOffer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreCategoryMap" ADD CONSTRAINT "StoreCategoryMap_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScrapeRun" ADD CONSTRAINT "ScrapeRun_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StagingOffer" ADD CONSTRAINT "StagingOffer_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ScrapeRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShoppingListItem" ADD CONSTRAINT "ShoppingListItem_listId_fkey" FOREIGN KEY ("listId") REFERENCES "ShoppingList"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShoppingListItem" ADD CONSTRAINT "ShoppingListItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceAlert" ADD CONSTRAINT "PriceAlert_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
