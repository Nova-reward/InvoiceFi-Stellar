import { Principal } from './principal';

/**
 * Minimal structural types for the Express request/response objects Nest
 * injects at runtime. Declared locally so the compliance module needs only the
 * handful of members it uses, without depending on `@types/express` (which the
 * rest of the wired backend also avoids).
 */

export interface ExportRequest {
  headers: {
    authorization?: string;
    cookie?: string;
    [key: string]: string | string[] | undefined;
  };
  /** Populated by ComplianceAccessGuard after successful authentication. */
  principal?: Principal;
}

export interface ExportResponse {
  status(code: number): unknown;
  setHeader(name: string, value: string): unknown;
  send(body: string): unknown;
}
