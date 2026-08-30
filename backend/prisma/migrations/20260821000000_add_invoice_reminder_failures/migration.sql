-- DLQ failure log for invoice-reminder jobs (issue: DLQ pattern).
-- Records every job that exhausted all Bull retries and was moved to the
-- dead-letter queue, providing an audit trail and triggering alerting.

-- CreateTable
CREATE TABLE "InvoiceReminderFailure" (
    "id"           TEXT        NOT NULL,
    "invoiceId"    TEXT        NOT NULL,
    "errorMessage" TEXT        NOT NULL,
    "attemptCount" INTEGER     NOT NULL,
    "jobId"        TEXT,
    "failedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoiceReminderFailure_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InvoiceReminderFailure_invoiceId_idx" ON "InvoiceReminderFailure"("invoiceId");

-- CreateIndex
CREATE INDEX "InvoiceReminderFailure_failedAt_idx" ON "InvoiceReminderFailure"("failedAt");
