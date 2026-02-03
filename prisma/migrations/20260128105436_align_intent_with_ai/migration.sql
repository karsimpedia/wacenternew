/*
  Warnings:

  - The values [SALDO,STATUS,PENDING,KOMPLAIN,REFUND,HELP,OTHER] on the enum `ChatIntentType` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "ChatIntentType_new" AS ENUM ('CHAT', 'CHECK_STATUS', 'COMPLAIN', 'FOLLOWUP', 'UNKNOWN');
ALTER TABLE "ChatMessage" ALTER COLUMN "intent" DROP DEFAULT;
ALTER TABLE "ChatSession" ALTER COLUMN "lastIntent" DROP DEFAULT;
ALTER TABLE "ChatSession" ALTER COLUMN "lastIntent" TYPE "ChatIntentType_new" USING ("lastIntent"::text::"ChatIntentType_new");
ALTER TABLE "ChatMessage" ALTER COLUMN "intent" TYPE "ChatIntentType_new" USING ("intent"::text::"ChatIntentType_new");
ALTER TABLE "ChatIntent" ALTER COLUMN "intent" TYPE "ChatIntentType_new" USING ("intent"::text::"ChatIntentType_new");
ALTER TYPE "ChatIntentType" RENAME TO "ChatIntentType_old";
ALTER TYPE "ChatIntentType_new" RENAME TO "ChatIntentType";
DROP TYPE "ChatIntentType_old";
ALTER TABLE "ChatMessage" ALTER COLUMN "intent" SET DEFAULT 'UNKNOWN';
ALTER TABLE "ChatSession" ALTER COLUMN "lastIntent" SET DEFAULT 'UNKNOWN';
COMMIT;
