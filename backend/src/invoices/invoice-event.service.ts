import { Injectable } from '@nestjs/common';
import { InvoiceStatus, Prisma, PrismaClient } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** Any Prisma handle that exposes the `invoiceEvent` delegate — a live client or an open `$transaction` callback's `tx`. */
type InvoiceEventWriter = PrismaClient | Prisma.TransactionClient;

export interface RecordInvoiceEventParams {
  invoiceOnchainId: bigint;
  previousStatus: InvoiceStatus | null;
  newStatus: InvoiceStatus;
  /** Wallet address or service name that triggered the transition. */
  actorId: string;
  /** Soroban transaction hash, when the transition was on-chain-triggered. */
  txHash?: string | null;
}

export interface InvoiceEventDto {
  id: string;
  invoiceOnchainId: string;
  previousStatus: InvoiceStatus | null;
  newStatus: InvoiceStatus;
  actorId: string;
  txHash: string | null;
  occurredAtNanos: string;
  createdAt: string;
}

/**
 * Nanosecond-precision epoch timestamp for audit display. Node has no native
 * OS-level nanosecond wall-clock API, so this combines Date.now() (ms
 * resolution) with the sub-millisecond remainder of process.hrtime() to add
 * resolution beyond what Postgres `timestamp` (microsecond) would give alone.
 * Ordering guarantees come from the DB-assigned `sequence` column, not this
 * value — see the `InvoiceEvent` model comment in schema.prisma.
 */
export function nowNanos(): bigint {
  const [, nanoRemainder] = process.hrtime();
  return BigInt(Date.now()) * 1_000_000n + BigInt(nanoRemainder % 1_000_000);
}

/**
 * Appends an invoice_events row. Callers that are already inside a
 * `prisma.db.$transaction(async (tx) => ...)` block should pass `tx` so the
 * event write is atomic with the status transition it records; this table is
 * append-only, so no update/delete variant is provided.
 */
export function appendInvoiceEvent(
  client: InvoiceEventWriter,
  params: RecordInvoiceEventParams,
): Promise<void> {
  return client.invoiceEvent
    .create({
      data: {
        invoiceOnchainId: params.invoiceOnchainId,
        previousStatus: params.previousStatus,
        newStatus: params.newStatus,
        actorId: params.actorId,
        txHash: params.txHash ?? null,
        occurredAtNanos: nowNanos(),
      },
    })
    .then(() => undefined);
}

function toDto(event: {
  id: string;
  invoiceOnchainId: bigint;
  previousStatus: InvoiceStatus | null;
  newStatus: InvoiceStatus;
  actorId: string;
  txHash: string | null;
  occurredAtNanos: bigint;
  createdAt: Date;
}): InvoiceEventDto {
  return {
    id: event.id,
    invoiceOnchainId: event.invoiceOnchainId.toString(),
    previousStatus: event.previousStatus,
    newStatus: event.newStatus,
    actorId: event.actorId,
    txHash: event.txHash,
    occurredAtNanos: event.occurredAtNanos.toString(),
    createdAt: event.createdAt.toISOString(),
  };
}

/** Read-side access to the invoice_events audit log, for the events endpoint. */
@Injectable()
export class InvoiceEventService {
  constructor(private readonly prisma: PrismaService) {}

  /** Full event history for one invoice, ordered oldest first by append order. */
  async listByOnchainId(onchainId: bigint): Promise<InvoiceEventDto[]> {
    const events = await this.prisma.db.invoiceEvent.findMany({
      where: { invoiceOnchainId: onchainId },
      orderBy: { sequence: 'asc' },
    });
    return events.map(toDto);
  }
}
