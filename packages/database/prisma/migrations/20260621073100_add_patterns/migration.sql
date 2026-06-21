-- CreateTable
CREATE TABLE "Pattern" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "entityName" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,

    CONSTRAINT "Pattern_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Pattern_type_idx" ON "Pattern"("type");

-- CreateIndex
CREATE INDEX "Pattern_entityName_idx" ON "Pattern"("entityName");

-- CreateIndex
CREATE INDEX "Pattern_detectedAt_idx" ON "Pattern"("detectedAt");
