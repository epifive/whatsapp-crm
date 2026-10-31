-- AlterEnum
ALTER TYPE "ImportStatus" ADD VALUE 'DRAFT';

-- DropForeignKey
ALTER TABLE "Deal" DROP CONSTRAINT "Deal_stageId_fkey";

-- AlterTable
ALTER TABLE "ContactImport" ALTER COLUMN "status" SET DEFAULT 'DRAFT';

-- AddForeignKey
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "Stage"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
