-- Expand Part 2: Backfill data from 'investor' to 'funder' and create index
-- This step populates the new column and prepares for the switch
-- Phase: expand
-- Description: Backfill funder column and create index for performance

-- Backfill: Copy all existing investor values to funder
UPDATE "Invoice" SET "funder" = "investor" WHERE "investor" IS NOT NULL;

-- Create index on the new funder column for query performance
CREATE INDEX "Invoice_funder_idx" ON "Invoice"("funder");

-- Add comment documenting the backfill
COMMENT ON COLUMN "Invoice"."funder" IS 'Replaces investor column. Backfilled from investor values. Application code now reads from this column.';
