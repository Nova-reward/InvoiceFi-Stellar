-- Expand Part 1: Add new 'funder' column alongside existing 'investor' column
-- This is the first step in renaming 'investor' to 'funder' using expand-contract pattern
-- Phase: expand
-- Description: Add new funder column (nullable) to prepare for investor->funder rename

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN "funder" TEXT;

-- Add comment to document the transition
COMMENT ON COLUMN "Invoice"."funder" IS 'New field replacing investor. Will be populated in next migration step.';

-- Keep the index on investor for now (will be recreated on funder in contract phase)
