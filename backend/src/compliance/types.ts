import { ExportFormat, ExportJobStatus, ExportType } from '@prisma/client';
import { IntegrityProof } from './signing';

/** Raw, unparsed query parameters accepted by the export endpoints. */
export interface RawExportQuery {
  format?: string;
  threshold?: string;
  since?: string;
  until?: string;
  subject?: string;
  async?: string;
}

/** A fully-built, signed export ready to return or persist. */
export interface InlineExport {
  filename: string;
  contentType: string;
  content: string;
  recordCount: number;
  byteLength: number;
  integrity: IntegrityProof;
}

/** Status view of an export job (never includes the document body). */
export interface JobSummary {
  id: string;
  type: ExportType;
  format: ExportFormat;
  status: ExportJobStatus;
  requestedBy: string;
  subject: string | null;
  recordCount: number | null;
  byteLength: number | null;
  contentType: string | null;
  integrity: {
    digestAlgorithm: string;
    sha256: string;
    signatureAlgorithm: string;
    signature: string;
    signerPublicKey: string;
  } | null;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  /** Present once the job is COMPLETED. */
  downloadUrl: string | null;
}
