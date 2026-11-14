CREATE TABLE "analytics_dashboard" (
  "id" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "shared" BOOLEAN NOT NULL DEFAULT false,
  "widgets" JSONB NOT NULL DEFAULT '[]',
  "refreshSeconds" INTEGER NOT NULL DEFAULT 0,
  "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "analytics_dashboard_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "analytics_dashboard_ownerId_idx" ON "analytics_dashboard"("ownerId");
