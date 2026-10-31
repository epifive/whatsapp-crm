-- CreateEnum
CREATE TYPE "AiMode" AS ENUM ('PLATFORM', 'OWN');

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "aiCredits" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "AiConfig" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "mode" "AiMode" NOT NULL DEFAULT 'PLATFORM',
    "provider" TEXT,
    "model" TEXT,
    "apiKeyEnc" TEXT,
    "instructions" TEXT,
    "autoReply" BOOLEAN NOT NULL DEFAULT false,
    "autoReplyWhen" TEXT NOT NULL DEFAULT 'unassigned',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeArticle" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeArticle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiUsage" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT,
    "feature" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "tokensIn" INTEGER NOT NULL DEFAULT 0,
    "tokensOut" INTEGER NOT NULL DEFAULT 0,
    "credits" INTEGER NOT NULL DEFAULT 0,
    "ok" BOOLEAN NOT NULL DEFAULT true,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiConfig_orgId_key" ON "AiConfig"("orgId");

-- CreateIndex
CREATE INDEX "KnowledgeArticle_orgId_isActive_idx" ON "KnowledgeArticle"("orgId", "isActive");

-- CreateIndex
CREATE INDEX "AiUsage_orgId_createdAt_idx" ON "AiUsage"("orgId", "createdAt");

-- AddForeignKey
ALTER TABLE "AiConfig" ADD CONSTRAINT "AiConfig_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeArticle" ADD CONSTRAINT "KnowledgeArticle_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiUsage" ADD CONSTRAINT "AiUsage_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
