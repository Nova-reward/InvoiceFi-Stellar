import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  ExportFormat,
  ExportJob,
  ExportJobStatus,
  ExportType,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { decimalToMinorUnits, minorUnitsToDecimal } from './amount';
import { ComplianceConfig } from './compliance.config';
import { toCsv } from './csv';
import { ExportSigningService } from './export-signing.service';
import { buildFatfRecords, FATF_FIELDS } from './fatf';
import {
  buildInvestorReport,
  INVESTOR_POSITION_FIELDS,
} from './investor-report';
import { isAdmin, Principal } from './principal';
import { InlineExport, JobSummary, RawExportQuery } from './types';

/** Resolved parameters for a transactions export. */
interface TransactionParams {
  format: ExportFormat;
  subject: string | null;
  thresholdMinorUnits: bigint;
  rangeStart?: Date;
  rangeEnd?: Date;
}

/** Resolved parameters for an investor report. */
interface InvestorParams {
  format: ExportFormat;
  subject: string;
}

@Injectable()
export class ComplianceService {
  private readonly logger = new Logger(ComplianceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ComplianceConfig,
    private readonly signing: ExportSigningService,
  ) {}

  // ─── Transactions (FATF Travel Rule) ──────────────────────────────────

  async exportTransactionsInline(
    principal: Principal,
    query: RawExportQuery,
  ): Promise<InlineExport> {
    const params = this.parseTransactionParams(principal, query);
    return this.buildTransactionsExport(params);
  }

  async enqueueTransactionsExport(
    principal: Principal,
    query: RawExportQuery,
  ): Promise<JobSummary> {
    const params = this.parseTransactionParams(principal, query);
    const job = await this.prisma.exportJob.create({
      data: {
        type: ExportType.TRANSACTIONS,
        format: params.format,
        status: ExportJobStatus.PENDING,
        requestedBy: principal.walletAddress,
        requesterRole: principal.role,
        subject: params.subject,
        thresholdMinorUnits: minorUnitsToDecimal(
          params.thresholdMinorUnits,
          this.config.assetDecimals,
        ),
        rangeStart: params.rangeStart ?? null,
        rangeEnd: params.rangeEnd ?? null,
      },
    });
    this.scheduleJob(job.id);
    return this.toJobSummary(job);
  }

  // ─── Investor report (portfolio + P&L) ────────────────────────────────

  async exportInvestorReportInline(
    principal: Principal,
    query: RawExportQuery,
  ): Promise<InlineExport> {
    const params = this.parseInvestorParams(principal, query);
    return this.buildInvestorExport(params);
  }

  async enqueueInvestorReportExport(
    principal: Principal,
    query: RawExportQuery,
  ): Promise<JobSummary> {
    const params = this.parseInvestorParams(principal, query);
    const job = await this.prisma.exportJob.create({
      data: {
        type: ExportType.INVESTOR_REPORT,
        format: params.format,
        status: ExportJobStatus.PENDING,
        requestedBy: principal.walletAddress,
        requesterRole: principal.role,
        subject: params.subject,
      },
    });
    this.scheduleJob(job.id);
    return this.toJobSummary(job);
  }

  // ─── Job status & download ────────────────────────────────────────────

  async getJob(principal: Principal, jobId: string): Promise<JobSummary> {
    const job = await this.loadAuthorizedJob(principal, jobId);
    return this.toJobSummary(job);
  }

  async downloadJob(principal: Principal, jobId: string): Promise<InlineExport> {
    const job = await this.loadAuthorizedJob(principal, jobId);
    if (job.status !== ExportJobStatus.COMPLETED || !job.content) {
      throw new BadRequestException(
        `Export ${jobId} is not ready (status: ${job.status})`,
      );
    }
    return {
      filename: this.filenameFor(job.type, job.format, job.subject),
      contentType: job.contentType ?? 'application/octet-stream',
      content: job.content,
      recordCount: job.recordCount ?? 0,
      byteLength: job.byteLength ?? Buffer.byteLength(job.content, 'utf8'),
      integrity: {
        digestAlgorithm: 'sha256',
        sha256: job.sha256 ?? '',
        signatureAlgorithm: 'ed25519',
        signature: job.signature ?? '',
        signerPublicKey: job.signerPublicKey ?? '',
      },
    };
  }

  /**
   * Process a queued job to completion. Runs detached from the request that
   * created it; failures are captured on the job row rather than thrown.
   */
  async processJob(jobId: string): Promise<void> {
    const job = await this.prisma.exportJob.findUnique({ where: { id: jobId } });
    if (!job || job.status !== ExportJobStatus.PENDING) {
      return;
    }
    await this.prisma.exportJob.update({
      where: { id: jobId },
      data: { status: ExportJobStatus.PROCESSING, startedAt: new Date() },
    });

    try {
      const built =
        job.type === ExportType.TRANSACTIONS
          ? await this.buildTransactionsExport({
              format: job.format,
              subject: job.subject,
              thresholdMinorUnits: job.thresholdMinorUnits
                ? decimalToMinorUnits(
                    job.thresholdMinorUnits,
                    this.config.assetDecimals,
                  )
                : 0n,
              rangeStart: job.rangeStart ?? undefined,
              rangeEnd: job.rangeEnd ?? undefined,
            })
          : await this.buildInvestorExport({
              format: job.format,
              subject: job.subject ?? '',
            });

      await this.prisma.exportJob.update({
        where: { id: jobId },
        data: {
          status: ExportJobStatus.COMPLETED,
          completedAt: new Date(),
          recordCount: built.recordCount,
          byteLength: built.byteLength,
          contentType: built.contentType,
          content: built.content,
          sha256: built.integrity.sha256,
          signature: built.integrity.signature,
          signerPublicKey: built.integrity.signerPublicKey,
        },
      });
    } catch (err) {
      this.logger.error(`Export job ${jobId} failed: ${String(err)}`);
      await this.prisma.exportJob.update({
        where: { id: jobId },
        data: {
          status: ExportJobStatus.FAILED,
          completedAt: new Date(),
          error: err instanceof Error ? err.message : String(err),
        },
      });
    }
  }

  // ─── Document builders ────────────────────────────────────────────────

  private async buildTransactionsExport(
    params: TransactionParams,
  ): Promise<InlineExport> {
    const invoices = await this.prisma.invoice.findMany({
      where: params.subject
        ? {
            OR: [{ farmer: params.subject }, { investor: params.subject }],
          }
        : {},
      orderBy: { onchainId: 'asc' },
    });

    const records = buildFatfRecords(invoices, {
      thresholdMinorUnits: params.thresholdMinorUnits,
      defaultAssetCode: this.config.assetCode,
      assetDecimals: this.config.assetDecimals,
      rangeStart: params.rangeStart,
      rangeEnd: params.rangeEnd,
    });

    let content: string;
    let contentType: string;
    if (params.format === ExportFormat.CSV) {
      content = toCsv(FATF_FIELDS, records);
      contentType = 'text/csv';
    } else {
      content = JSON.stringify(
        {
          schemaVersion: this.config.schemaVersion,
          exportType: ExportType.TRANSACTIONS,
          generatedAt: new Date().toISOString(),
          asset: {
            code: this.config.assetCode,
            decimals: this.config.assetDecimals,
          },
          threshold: {
            minorUnits: params.thresholdMinorUnits.toString(),
            decimal: minorUnitsToDecimal(
              params.thresholdMinorUnits,
              this.config.assetDecimals,
            ),
          },
          scope: {
            subject: params.subject,
            rangeStart: params.rangeStart?.toISOString() ?? null,
            rangeEnd: params.rangeEnd?.toISOString() ?? null,
          },
          recordCount: records.length,
          records,
        },
        null,
        2,
      );
      contentType = 'application/json';
    }

    return this.finalize(
      content,
      contentType,
      records.length,
      this.filenameFor(ExportType.TRANSACTIONS, params.format, params.subject),
    );
  }

  private async buildInvestorExport(
    params: InvestorParams,
  ): Promise<InlineExport> {
    const invoices = await this.prisma.invoice.findMany({
      where: { investor: params.subject },
      orderBy: { onchainId: 'asc' },
    });

    const report = buildInvestorReport(params.subject, invoices, {
      defaultAssetCode: this.config.assetCode,
      assetDecimals: this.config.assetDecimals,
    });

    let content: string;
    let contentType: string;
    if (params.format === ExportFormat.CSV) {
      content = toCsv(INVESTOR_POSITION_FIELDS, report.positions);
      contentType = 'text/csv';
    } else {
      content = JSON.stringify(
        {
          schemaVersion: this.config.schemaVersion,
          exportType: ExportType.INVESTOR_REPORT,
          generatedAt: new Date().toISOString(),
          asset: {
            code: this.config.assetCode,
            decimals: this.config.assetDecimals,
          },
          scope: { subject: params.subject },
          report,
        },
        null,
        2,
      );
      contentType = 'application/json';
    }

    return this.finalize(
      content,
      contentType,
      report.positions.length,
      this.filenameFor(
        ExportType.INVESTOR_REPORT,
        params.format,
        params.subject,
      ),
    );
  }

  private finalize(
    content: string,
    contentType: string,
    recordCount: number,
    filename: string,
  ): InlineExport {
    const integrity = this.signing.sign(content);
    return {
      filename,
      contentType,
      content,
      recordCount,
      byteLength: Buffer.byteLength(content, 'utf8'),
      integrity,
    };
  }

  // ─── Parameter parsing & access scoping ───────────────────────────────

  private parseTransactionParams(
    principal: Principal,
    query: RawExportQuery,
  ): TransactionParams {
    const format = this.parseFormat(query.format);
    const subject = this.resolveTransactionSubject(principal, query.subject);
    const thresholdDecimal =
      query.threshold ?? this.config.defaultThresholdDecimal;
    let thresholdMinorUnits: bigint;
    try {
      thresholdMinorUnits = decimalToMinorUnits(
        thresholdDecimal,
        this.config.assetDecimals,
      );
    } catch (err) {
      throw new BadRequestException(
        err instanceof Error ? err.message : 'Invalid threshold',
      );
    }
    if (thresholdMinorUnits < 0n) {
      throw new BadRequestException('threshold must not be negative');
    }
    return {
      format,
      subject,
      thresholdMinorUnits,
      rangeStart: this.parseDate(query.since, 'since'),
      rangeEnd: this.parseDate(query.until, 'until'),
    };
  }

  private parseInvestorParams(
    principal: Principal,
    query: RawExportQuery,
  ): InvestorParams {
    return {
      format: this.parseFormat(query.format),
      subject: this.resolveInvestorSubject(principal, query.subject),
    };
  }

  private parseFormat(raw?: string): ExportFormat {
    const value = (raw ?? 'json').toLowerCase();
    if (value === 'json') return ExportFormat.JSON;
    if (value === 'csv') return ExportFormat.CSV;
    throw new BadRequestException(`Unsupported format: ${raw}`);
  }

  private parseDate(raw: string | undefined, field: string): Date | undefined {
    if (raw === undefined || raw === '') return undefined;
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException(`Invalid ${field} date: ${raw}`);
    }
    return date;
  }

  /**
   * Transactions scope: admins may target any subject or all data (null);
   * everyone else is restricted to their own wallet and may not request
   * another subject or an all-data export.
   */
  private resolveTransactionSubject(
    principal: Principal,
    requested?: string,
  ): string | null {
    if (isAdmin(principal)) {
      return requested && requested.length > 0 ? requested : null;
    }
    if (requested && requested !== principal.walletAddress) {
      throw new ForbiddenException(
        'You may only export your own transaction data',
      );
    }
    return principal.walletAddress;
  }

  /**
   * Investor report scope: admins must name the investor; everyone else is
   * pinned to their own wallet.
   */
  private resolveInvestorSubject(
    principal: Principal,
    requested?: string,
  ): string {
    if (isAdmin(principal)) {
      if (!requested) {
        throw new BadRequestException(
          'subject (investor wallet) is required for admin investor reports',
        );
      }
      return requested;
    }
    if (requested && requested !== principal.walletAddress) {
      throw new ForbiddenException('You may only export your own report');
    }
    return principal.walletAddress;
  }

  private async loadAuthorizedJob(
    principal: Principal,
    jobId: string,
  ): Promise<ExportJob> {
    const job = await this.prisma.exportJob.findUnique({
      where: { id: jobId },
    });
    if (!job) {
      throw new NotFoundException(`Export job ${jobId} not found`);
    }
    if (!isAdmin(principal) && job.requestedBy !== principal.walletAddress) {
      // Do not leak existence of another user's job.
      throw new NotFoundException(`Export job ${jobId} not found`);
    }
    return job;
  }

  // ─── Helpers ──────────────────────────────────────────────────────────

  /** Fire-and-forget job processing; errors are recorded on the job row. */
  private scheduleJob(jobId: string): void {
    setImmediate(() => {
      void this.processJob(jobId);
    });
  }

  private filenameFor(
    type: ExportType,
    format: ExportFormat,
    subject: string | null,
  ): string {
    const ext = format === ExportFormat.CSV ? 'csv' : 'json';
    const base =
      type === ExportType.TRANSACTIONS
        ? 'transactions-export'
        : 'investor-report';
    const scope = subject ? `-${subject}` : '-all';
    const stamp = new Date().toISOString().slice(0, 10);
    return `${base}${scope}-${stamp}.${ext}`;
  }

  private toJobSummary(job: ExportJob): JobSummary {
    const completed = job.status === ExportJobStatus.COMPLETED;
    return {
      id: job.id,
      type: job.type,
      format: job.format,
      status: job.status,
      requestedBy: job.requestedBy,
      subject: job.subject,
      recordCount: job.recordCount,
      byteLength: job.byteLength,
      contentType: job.contentType,
      integrity:
        completed && job.sha256 && job.signature && job.signerPublicKey
          ? {
              digestAlgorithm: 'sha256',
              sha256: job.sha256,
              signatureAlgorithm: 'ed25519',
              signature: job.signature,
              signerPublicKey: job.signerPublicKey,
            }
          : null,
      error: job.error,
      createdAt: job.createdAt.toISOString(),
      startedAt: job.startedAt?.toISOString() ?? null,
      completedAt: job.completedAt?.toISOString() ?? null,
      downloadUrl: completed
        ? `/compliance/exports/jobs/${job.id}/download`
        : null,
    };
  }
}
