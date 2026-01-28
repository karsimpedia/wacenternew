-- CreateEnum
CREATE TYPE "ChatChannel" AS ENUM ('WA', 'TELEGRAM', 'WEB');

-- CreateEnum
CREATE TYPE "ChatRole" AS ENUM ('USER', 'AI', 'SYSTEM', 'AGENT');

-- CreateEnum
CREATE TYPE "ChatMood" AS ENUM ('NORMAL', 'KESAL', 'MARAH');

-- CreateEnum
CREATE TYPE "ChatIntentType" AS ENUM ('UNKNOWN', 'SALDO', 'STATUS', 'PENDING', 'KOMPLAIN', 'REFUND', 'HELP', 'OTHER');

-- CreateEnum
CREATE TYPE "EscalationStatus" AS ENUM ('OPEN', 'ASSIGNED', 'RESOLVED', 'CANCELED');

-- CreateEnum
CREATE TYPE "AIDecisionAction" AS ENUM ('REPLY', 'ASK', 'ESCALATE', 'IGNORE');

-- CreateTable
CREATE TABLE "ChatSession" (
    "id" TEXT NOT NULL,
    "channel" "ChatChannel" NOT NULL DEFAULT 'WA',
    "userKey" TEXT NOT NULL,
    "lastIntent" "ChatIntentType" NOT NULL DEFAULT 'UNKNOWN',
    "lastContext" TEXT,
    "mood" "ChatMood" NOT NULL DEFAULT 'NORMAL',
    "aiEnabled" BOOLEAN NOT NULL DEFAULT true,
    "escalated" BOOLEAN NOT NULL DEFAULT false,
    "lastMessageAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "role" "ChatRole" NOT NULL,
    "message" TEXT NOT NULL,
    "intent" "ChatIntentType" NOT NULL DEFAULT 'UNKNOWN',
    "externalId" TEXT,
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatSummary" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "short" TEXT,
    "lastWindow" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatSummary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatIntent" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "intent" "ChatIntentType" NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatIntent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIDecision" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "action" "AIDecisionAction" NOT NULL,
    "reason" TEXT,
    "promptHash" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AIDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatEscalation" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "status" "EscalationStatus" NOT NULL DEFAULT 'OPEN',
    "reason" TEXT NOT NULL,
    "assignedTo" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "ChatEscalation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChatSession_userKey_idx" ON "ChatSession"("userKey");

-- CreateIndex
CREATE INDEX "ChatSession_lastMessageAt_idx" ON "ChatSession"("lastMessageAt");

-- CreateIndex
CREATE UNIQUE INDEX "ChatSession_channel_userKey_key" ON "ChatSession"("channel", "userKey");

-- CreateIndex
CREATE INDEX "ChatMessage_sessionId_createdAt_idx" ON "ChatMessage"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "ChatMessage_role_idx" ON "ChatMessage"("role");

-- CreateIndex
CREATE UNIQUE INDEX "ChatMessage_sessionId_externalId_key" ON "ChatMessage"("sessionId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "ChatSummary_sessionId_key" ON "ChatSummary"("sessionId");

-- CreateIndex
CREATE INDEX "ChatIntent_sessionId_createdAt_idx" ON "ChatIntent"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "ChatIntent_intent_idx" ON "ChatIntent"("intent");

-- CreateIndex
CREATE INDEX "AIDecision_sessionId_createdAt_idx" ON "AIDecision"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "AIDecision_action_idx" ON "AIDecision"("action");

-- CreateIndex
CREATE INDEX "ChatEscalation_status_idx" ON "ChatEscalation"("status");

-- CreateIndex
CREATE INDEX "ChatEscalation_sessionId_idx" ON "ChatEscalation"("sessionId");

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ChatSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatSummary" ADD CONSTRAINT "ChatSummary_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ChatSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatIntent" ADD CONSTRAINT "ChatIntent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ChatSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIDecision" ADD CONSTRAINT "AIDecision_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ChatSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatEscalation" ADD CONSTRAINT "ChatEscalation_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ChatSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
