-- CreateExtension (skipped — pgvector not available in this environment)
-- CREATE EXTENSION IF NOT EXISTS "pgvector";

-- AlterTable (skipped — pgvector extension not available)
-- ALTER TABLE "News" ALTER COLUMN "embedding" SET DATA TYPE vector(1536);

-- CreateTable
CREATE TABLE "PoliticalFigure" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "aliases" JSONB NOT NULL,
    "party" TEXT NOT NULL,
    "position" TEXT NOT NULL,
    "tier" INTEGER NOT NULL DEFAULT 2,
    "mentionCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PoliticalFigure_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArticlePolitician" (
    "articleId" TEXT NOT NULL,
    "figureId" TEXT NOT NULL,
    "sentiment" DOUBLE PRECISION NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "ArticlePolitician_pkey" PRIMARY KEY ("articleId","figureId")
);

-- CreateTable
CREATE TABLE "ProvinceSecurityStats" (
    "province" TEXT NOT NULL,
    "total_events_7d" INTEGER NOT NULL,
    "total_events_30d" INTEGER NOT NULL,
    "crime_density" DOUBLE PRECISION NOT NULL,
    "trend_direction" TEXT NOT NULL,
    "top_categories" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProvinceSecurityStats_pkey" PRIMARY KEY ("province")
);

-- CreateTable
CREATE TABLE "ProvincePopulation" (
    "province" TEXT NOT NULL,
    "population" INTEGER NOT NULL,

    CONSTRAINT "ProvincePopulation_pkey" PRIMARY KEY ("province")
);

-- CreateTable
CREATE TABLE "ActiveProtest" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "province" TEXT NOT NULL,
    "city" TEXT,
    "route_name" TEXT,
    "km" INTEGER,
    "protest_type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "resolved_at" TIMESTAMP(3),
    "estimated_duration_minutes" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActiveProtest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_briefings" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "summary" TEXT NOT NULL,
    "topEvents" JSONB NOT NULL,
    "predictions" JSONB,
    "patterns" JSONB,
    "healthScore" DOUBLE PRECISION NOT NULL,
    "stats" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_briefings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "predictions" (
    "id" TEXT NOT NULL,
    "entityName" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "reason" TEXT NOT NULL,
    "predictedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "predictions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "health_reports" (
    "id" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "services" JSONB NOT NULL,
    "queues" JSONB NOT NULL,
    "budget" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "health_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PoliticalFigure_name_key" ON "PoliticalFigure"("name");

-- CreateIndex
CREATE INDEX "ActiveProtest_status_idx" ON "ActiveProtest"("status");

-- CreateIndex
CREATE INDEX "ActiveProtest_province_idx" ON "ActiveProtest"("province");

-- CreateIndex
CREATE UNIQUE INDEX "daily_briefings_date_key" ON "daily_briefings"("date");

-- AddForeignKey
ALTER TABLE "ArticlePolitician" ADD CONSTRAINT "ArticlePolitician_figureId_fkey" FOREIGN KEY ("figureId") REFERENCES "PoliticalFigure"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArticlePolitician" ADD CONSTRAINT "ArticlePolitician_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "News"("id") ON DELETE CASCADE ON UPDATE CASCADE;
