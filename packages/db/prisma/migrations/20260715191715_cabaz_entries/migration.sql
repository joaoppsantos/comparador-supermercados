-- CreateTable
CREATE TABLE "CabazEntry" (
    "id" SERIAL NOT NULL,
    "label" TEXT NOT NULL,
    "tokens" TEXT[],
    "targetQtyValue" DECIMAL(65,30),
    "targetQtyUnit" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CabazEntry_pkey" PRIMARY KEY ("id")
);
