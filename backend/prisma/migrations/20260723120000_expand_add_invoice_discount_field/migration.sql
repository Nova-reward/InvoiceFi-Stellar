-- Expand: Add nullable discount percentage field to Invoice table
-- This migration adds a new nullable column without table locks (PostgreSQL 11+)
-- Phase: expand
-- Description: Add discountPercentage field for future discount functionality

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN "discountPercentage" NUMERIC(5, 2);

-- Add comment to document the new field
COMMENT ON COLUMN "Invoice"."discountPercentage" IS 'Discount percentage applied to invoice (0-100). Nullable for backward compatibility.';
