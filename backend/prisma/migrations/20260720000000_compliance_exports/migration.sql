-- CreateEnum
CREATE TYPE "ExportType" AS ENUM ('TRANSACTIONS', 'INVESTOR_REPORT');

-- CreateEnum
CREATE TYPE "ExportFormat" AS ENUM ('JSON', 'CSV');

-- CreateEnum
CREATE TYPE "ExportJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "fundedAmount" BIGINT;
ALTER TABLE "Invoice" ADD COLUMN     "repaidAmount" BIGINT;
ALTER TABLE "Invoice" ADD COLUMN     "assetCode" TEXT;

-- CreateTable
CREATE TABLE "ExportJob" (
    "id" TEXT NOT NULL,
    "type" "ExportType" NOT NULL,
    "format" "ExportFormat" NOT NULL,
    "status" "ExportJobStatus" NOT NULL DEFAULT 'PENDING',
    "requestedBy" TEXT NOT NULL,
    "requesterRole" TEXT NOT NULL,
    "subject" TEXT,
    "thresholdMinorUnits" TEXT,
    "rangeStart" TIMESTAMP(3),
    "rangeEnd" TIMESTAMP(3),
    "recordCount" INTEGER,
    "byteLength" INTEGER,
    "sha256" TEXT,
    "signature" TEXT,
    "signerPublicKey" TEXT,
    "content" TEXT,
    "contentType" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ExportJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExportJob_requestedBy_idx" ON "ExportJob"("requestedBy");

-- CreateIndex
CREATE INDEX "ExportJob_status_idx" ON "ExportJob"("status");
