import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const CURSOR_ID = 1;

/** Persists the last Soroban ledger processed by the settlement listener. */
@Injectable()
export class SyncCursorService {
  constructor(private readonly prisma: PrismaService) {}

  async getLastLedger(): Promise<number> {
    const row = await this.prisma.syncCursor.findUnique({
      where: { id: CURSOR_ID },
    });
    return row?.lastLedger ?? 0;
  }

  async setLastLedger(ledger: number): Promise<void> {
    await this.prisma.syncCursor.upsert({
      where: { id: CURSOR_ID },
      create: { id: CURSOR_ID, lastLedger: ledger },
      update: { lastLedger: ledger },
    });
  }
}
