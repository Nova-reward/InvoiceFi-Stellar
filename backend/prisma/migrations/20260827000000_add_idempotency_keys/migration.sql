-- Migration: Add IdempotencyKey table for DB-level idempotency locking (closes #55)
--
-- Stores client-submitted Idempotency-Key values alongside a SHA-256 body
-- fingerprint so the backend can:
--   * detect concurrent duplicates via the unique constraint + lockedAt column
--   * return 409 Conflict when the same key is reused with a different body
--   * replay the cached response for legitimate retries
--   * expire records after a configurable TTL (default 24 h)

CREATE TABLE "IdempotencyKey" (
    "id"           TEXT        NOT NULL,
    "key"          TEXT        NOT NULL,
    "userId"       TEXT        NOT NULL,
    "bodyHash"     TEXT        NOT NULL,
    "statusCode"   INTEGER     NOT NULL DEFAULT 0,
    "responseBody" JSONB       NOT NULL DEFAULT '{}',
    "requestPath"  TEXT        NOT NULL,
    "lockedAt"     TIMESTAMP(3),
    "lockOwner"    TEXT,
    "expiresAt"    TIMESTAMP(3) NOT NULL,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY ("id")
);

-- Enforce uniqueness of (key, userId) — a key is scoped per user
CREATE UNIQUE INDEX "IdempotencyKey_key_userId_key" ON "IdempotencyKey"("key", "userId");

-- Support efficient lookup by userId
CREATE INDEX "IdempotencyKey_userId_idx" ON "IdempotencyKey"("userId");

-- Support efficient cleanup queries (delete where expiresAt < now())
CREATE INDEX "IdempotencyKey_expiresAt_idx" ON "IdempotencyKey"("expiresAt");

-- Support stale-lock reclaim queries (find rows where lockedAt < 5-min-ago)
CREATE INDEX "IdempotencyKey_lockedAt_idx" ON "IdempotencyKey"("lockedAt");
