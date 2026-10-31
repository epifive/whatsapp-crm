-- AlterTable
ALTER TABLE "AiConfig" DROP COLUMN "mode";

-- AlterTable
ALTER TABLE "AiUsage" DROP COLUMN "credits";

-- AlterTable
ALTER TABLE "Organization" DROP COLUMN "aiCredits";

-- DropEnum
DROP TYPE "AiMode";


-- The platform AI key is no longer used: every workspace connects its own AI account
DELETE FROM "Setting" WHERE "key" = 'ai';
