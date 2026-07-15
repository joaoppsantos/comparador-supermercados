-- CreateTable
CREATE TABLE "CabazEntryChoice" (
    "entryId" INTEGER NOT NULL,
    "storeId" INTEGER NOT NULL,
    "productId" INTEGER NOT NULL,

    CONSTRAINT "CabazEntryChoice_pkey" PRIMARY KEY ("entryId","storeId")
);

-- AddForeignKey
ALTER TABLE "CabazEntryChoice" ADD CONSTRAINT "CabazEntryChoice_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "CabazEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CabazEntryChoice" ADD CONSTRAINT "CabazEntryChoice_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CabazEntryChoice" ADD CONSTRAINT "CabazEntryChoice_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
