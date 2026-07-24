-- Contract: Remove deprecated 'investor' column after application code migration
-- This is the final step in the investor->funder rename
-- Phase: contract
-- Description: Remove old investor column and its index

-- Prerequisites:
-- - Application code has been updated to read/write 'funder' instead of 'investor'
-- - All application instances have been deployed with the new code
-- - Backfill migration (part 2) has been applied to production

-- Drop the old index
DROP INDEX IF EXISTS "Invoice_investor_idx";

-- Drop the old column
ALTER TABLE "Invoice" DROP COLUMN IF EXISTS "investor";

-- Add comment documenting the completion
COMMENT ON COLUMN "Invoice"."funder" IS 'Wallet address of the entity funding the invoice. Replaces the deprecated investor column.';
