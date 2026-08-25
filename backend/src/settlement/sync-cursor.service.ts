import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const CURSOR_ID = 1;

/**
 * Minimal Prisma transaction-client shape that this service needs.
 * Using a structural type keeps the service decoupled from the full
 * generated Prisma namespace while remaining type-safe.
 */
export type SyncCursorTxClient = Pick<PrismaClient, 'syncCursor'>;

/** Persists the last Soroban ledger processed by the settlement listener. */
@Injectable()
export class SyncCursorService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Returns the last fully-processed ledger sequence, or 0 on first run.
   */
  async getLastLedger(): Promise<number> {
    const row = await this.prisma.syncCursor.findUnique({
      where: { id: CURSOR_ID },
    });
    return row?.lastLedger ?? 0;
  }

  /**
   * Persists `ledger` as the new cursor.
   *
   * When a Prisma transaction client (`tx`) is supplied the write is enlisted
   * in that transaction, so the cursor advance is atomic with whatever other
   * operations the caller performs in the same transaction (e.g. settling an
   * invoice). If `tx` is omitted the write is issued as a standalone operation.
   *
   * @param ledger - The ledger sequence number to persist.
   * @param tx     - Optional Prisma interactive-transaction client.
   */
  async setLastLedger(
    ledger: number,
    tx?: SyncCursorTxClient,
  ): Promise<void> {
    const client = tx ?? this.prisma;
    await client.syncCursor.upsert({
      where: { id: CURSOR_ID },
      create: { id: CURSOR_ID, lastLedger: ledger },
      update: { lastLedger: ledger },
    });
  }
}
