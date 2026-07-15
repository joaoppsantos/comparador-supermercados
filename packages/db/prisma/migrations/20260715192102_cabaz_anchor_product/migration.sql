-- AlterTable
ALTER TABLE "CabazEntry" ADD COLUMN     "productId" INTEGER;

-- AddForeignKey
ALTER TABLE "CabazEntry" ADD CONSTRAINT "CabazEntry_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
