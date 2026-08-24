-- Expand (issue #162): append-only invoice_events audit table.
-- Additive only — new table, new FK, new index. No existing columns touched.
-- Phase: expand

-- CreateTable
CREATE TABLE "InvoiceEvent" (
    "id" TEXT NOT NULL,
    "invoiceOnchainId" BIGINT NOT NULL,
    "previousStatus" "InvoiceStatus",
    "newStatus" "InvoiceStatus" NOT NULL,
    "actorId" TEXT NOT NULL,
    "txHash" TEXT,
    "occurredAtNanos" BIGINT NOT NULL,
    "sequence" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoiceEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InvoiceEvent_invoiceOnchainId_sequence_idx" ON "InvoiceEvent"("invoiceOnchainId", "sequence");

-- AddForeignKey
ALTER TABLE "InvoiceEvent" ADD CONSTRAINT "InvoiceEvent_invoiceOnchainId_fkey" FOREIGN KEY ("invoiceOnchainId") REFERENCES "Invoice"("onchainId") ON DELETE RESTRICT ON UPDATE CASCADE;
