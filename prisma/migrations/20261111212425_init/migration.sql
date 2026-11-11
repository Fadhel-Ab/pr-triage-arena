-- CreateEnum
CREATE TYPE "Domain" AS ENUM ('FULL_STACK', 'BACKEND_API', 'FRONTEND_STATE_UI', 'DATABASE_SECURITY', 'MOBILE_FLUTTER');

-- CreateEnum
CREATE TYPE "StackMode" AS ENUM ('CORE', 'CURVEBALL');

-- CreateEnum
CREATE TYPE "PacingMode" AS ENUM ('SPRINT', 'FULL_SIMULATION');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('READY', 'IN_PROGRESS', 'SUBMITTED', 'GRADED', 'GRADING_FAILED');

-- CreateEnum
CREATE TYPE "StageKind" AS ENUM ('BRIEF', 'FILE');

-- CreateEnum
CREATE TYPE "LockReason" AS ENUM ('MANUAL', 'TIMEOUT', 'EXPIRED');

-- CreateEnum
CREATE TYPE "TruthSeverity" AS ENUM ('P0', 'P1', 'P2', 'INTENTIONAL', 'CLEAN');

-- CreateEnum
CREATE TYPE "Verdict" AS ENUM ('P0', 'P1', 'P2', 'CLEAN_OR_INTENTIONAL', 'STRATEGIC_SKIP');

-- CreateEnum
CREATE TYPE "TelemetryType" AS ENUM ('BRIEF_TOGGLED', 'HUNK_FOCUSED', 'VERDICT_CHANGED', 'WORD_CAP_HIT', 'TAB_HIDDEN', 'TAB_VISIBLE');

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "status" "SessionStatus" NOT NULL DEFAULT 'READY',
    "domain" "Domain" NOT NULL,
    "stackMode" "StackMode" NOT NULL,
    "pacing" "PacingMode" NOT NULL,
    "title" TEXT NOT NULL,
    "prSummary" TEXT NOT NULL,
    "briefContext" TEXT NOT NULL,
    "briefRules" TEXT[],
    "briefPolicies" JSONB NOT NULL,
    "stackLabel" TEXT NOT NULL,
    "currentStageIndex" INTEGER NOT NULL DEFAULT -1,
    "startedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "generationMs" INTEGER NOT NULL,
    "generationTries" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionStage" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "kind" "StageKind" NOT NULL,
    "fileId" TEXT,
    "durationSec" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3),
    "deadlineAt" TIMESTAMP(3),
    "lockedAt" TIMESTAMP(3),
    "lockReason" "LockReason",

    CONSTRAINT "SessionStage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeneratedFile" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "path" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,

    CONSTRAINT "GeneratedFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Hunk" (
    "id" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "startLine" INTEGER NOT NULL,
    "endLine" INTEGER NOT NULL,
    "code" TEXT NOT NULL,

    CONSTRAINT "Hunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HunkGroundTruth" (
    "id" TEXT NOT NULL,
    "hunkId" TEXT NOT NULL,
    "severity" "TruthSeverity" NOT NULL,
    "category" TEXT NOT NULL,
    "defect" TEXT NOT NULL,
    "blastRadius" TEXT NOT NULL,
    "canonicalFix" TEXT NOT NULL,
    "evidenceLines" INTEGER[],
    "policyId" TEXT,
    "decoyReason" TEXT,
    "graderNotes" TEXT NOT NULL,

    CONSTRAINT "HunkGroundTruth_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserSubmission" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "hunkId" TEXT NOT NULL,
    "verdict" "Verdict",
    "defectSummary" TEXT NOT NULL DEFAULT '',
    "blastRadius" TEXT NOT NULL DEFAULT '',
    "oneLineFix" TEXT NOT NULL DEFAULT '',
    "lockedAt" TIMESTAMP(3) NOT NULL,
    "points" DOUBLE PRECISION,
    "isFalsePositive" BOOLEAN,
    "isMissedDefect" BOOLEAN,
    "graderFeedback" TEXT,

    CONSTRAINT "UserSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelemetryEvent" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "type" "TelemetryType" NOT NULL,
    "stageIndex" INTEGER NOT NULL,
    "hunkId" TEXT,
    "payload" JSONB,
    "clientAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TelemetryEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GradeReport" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "totalScore" DOUBLE PRECISION NOT NULL,
    "maxScore" DOUBLE PRECISION NOT NULL,
    "p0Caught" INTEGER NOT NULL,
    "p0Total" INTEGER NOT NULL,
    "p1Caught" INTEGER NOT NULL,
    "p1Total" INTEGER NOT NULL,
    "falsePositives" INTEGER NOT NULL,
    "falsePositiveRate" DOUBLE PRECISION NOT NULL,
    "answeredCount" INTEGER NOT NULL,
    "skippedCount" INTEGER NOT NULL,
    "unansweredCount" INTEGER NOT NULL,
    "briefSeconds" INTEGER NOT NULL,
    "secondsPerFile" JSONB NOT NULL,
    "weakCategories" TEXT[],
    "summary" TEXT NOT NULL,
    "graderModel" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GradeReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Session_createdAt_idx" ON "Session"("createdAt");

-- CreateIndex
CREATE INDEX "Session_domain_stackMode_idx" ON "Session"("domain", "stackMode");

-- CreateIndex
CREATE UNIQUE INDEX "SessionStage_fileId_key" ON "SessionStage"("fileId");

-- CreateIndex
CREATE UNIQUE INDEX "SessionStage_sessionId_index_key" ON "SessionStage"("sessionId", "index");

-- CreateIndex
CREATE UNIQUE INDEX "GeneratedFile_sessionId_order_key" ON "GeneratedFile"("sessionId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "Hunk_fileId_order_key" ON "Hunk"("fileId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "HunkGroundTruth_hunkId_key" ON "HunkGroundTruth"("hunkId");

-- CreateIndex
CREATE UNIQUE INDEX "UserSubmission_sessionId_hunkId_key" ON "UserSubmission"("sessionId", "hunkId");

-- CreateIndex
CREATE INDEX "TelemetryEvent_sessionId_stageIndex_idx" ON "TelemetryEvent"("sessionId", "stageIndex");

-- CreateIndex
CREATE UNIQUE INDEX "GradeReport_sessionId_key" ON "GradeReport"("sessionId");

-- CreateIndex
CREATE INDEX "GradeReport_createdAt_idx" ON "GradeReport"("createdAt");

-- AddForeignKey
ALTER TABLE "SessionStage" ADD CONSTRAINT "SessionStage_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionStage" ADD CONSTRAINT "SessionStage_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "GeneratedFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedFile" ADD CONSTRAINT "GeneratedFile_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Hunk" ADD CONSTRAINT "Hunk_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "GeneratedFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HunkGroundTruth" ADD CONSTRAINT "HunkGroundTruth_hunkId_fkey" FOREIGN KEY ("hunkId") REFERENCES "Hunk"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSubmission" ADD CONSTRAINT "UserSubmission_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSubmission" ADD CONSTRAINT "UserSubmission_hunkId_fkey" FOREIGN KEY ("hunkId") REFERENCES "Hunk"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelemetryEvent" ADD CONSTRAINT "TelemetryEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GradeReport" ADD CONSTRAINT "GradeReport_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
