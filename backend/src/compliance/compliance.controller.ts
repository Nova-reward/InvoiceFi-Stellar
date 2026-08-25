import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ComplianceAccessGuard } from './compliance-access.guard';
import { ComplianceService } from './compliance.service';
import { ExportResponse } from './http';
import { Principal } from './principal';
import { InlineExport, JobSummary, RawExportQuery } from './types';

interface AuthedRequest {
  principal: Principal;
}

/**
 * Regulatory disclosure export API.
 *
 * Every route requires a verified JWT (ComplianceAccessGuard). Admins may
 * export any subject's data; other roles are scoped to their own wallet
 * (enforced in ComplianceService). Small exports are returned inline; large
 * ones are generated asynchronously via `?async=true` and retrieved through
 * the job endpoints.
 */
@Controller('compliance/exports')
@UseGuards(ComplianceAccessGuard)
export class ComplianceController {
  constructor(private readonly compliance: ComplianceService) {}

  /**
   * FATF Travel Rule fields for all qualifying transactions above the
   * threshold. Returns the signed document inline by default, or a 202 job
   * summary when `async=true`.
   */
  @Get('transactions')
  async transactions(
    @Req() req: AuthedRequest,
    @Query() query: RawExportQuery,
    @Res({ passthrough: true }) res: ExportResponse,
  ): Promise<JobSummary | void> {
    if (isAsync(query)) {
      const job = await this.compliance.enqueueTransactionsExport(
        req.principal,
        query,
      );
      res.status(HttpStatus.ACCEPTED);
      res.setHeader('Location', `/compliance/exports/jobs/${job.id}`);
      return job;
    }
    const result = await this.compliance.exportTransactionsInline(
      req.principal,
      query,
    );
    sendInline(res, result);
  }

  /**
   * Investor portfolio report with realized/unrealized P&L. Inline by default,
   * or a 202 job summary when `async=true`.
   */
  @Get('investor-report')
  async investorReport(
    @Req() req: AuthedRequest,
    @Query() query: RawExportQuery,
    @Res({ passthrough: true }) res: ExportResponse,
  ): Promise<JobSummary | void> {
    if (isAsync(query)) {
      const job = await this.compliance.enqueueInvestorReportExport(
        req.principal,
        query,
      );
      res.status(HttpStatus.ACCEPTED);
      res.setHeader('Location', `/compliance/exports/jobs/${job.id}`);
      return job;
    }
    const result = await this.compliance.exportInvestorReportInline(
      req.principal,
      query,
    );
    sendInline(res, result);
  }

  /** Poll the status of an asynchronous export job. */
  @Get('jobs/:id')
  @HttpCode(HttpStatus.OK)
  getJob(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
  ): Promise<JobSummary> {
    return this.compliance.getJob(req.principal, id);
  }

  /** Download the signed document produced by a completed job. */
  @Get('jobs/:id/download')
  async download(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Res({ passthrough: true }) res: ExportResponse,
  ): Promise<void> {
    const result = await this.compliance.downloadJob(req.principal, id);
    sendInline(res, result);
  }
}

function isAsync(query: RawExportQuery): boolean {
  return String(query.async).toLowerCase() === 'true';
}

/**
 * Write a signed export as the response body, exposing the integrity proof in
 * headers so a client can verify the bytes it received without re-parsing.
 */
function sendInline(res: ExportResponse, result: InlineExport): void {
  res.setHeader('Content-Type', result.contentType);
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${result.filename}"`,
  );
  res.setHeader('X-Export-Digest-Algorithm', result.integrity.digestAlgorithm);
  res.setHeader('X-Export-Sha256', result.integrity.sha256);
  res.setHeader(
    'X-Export-Signature-Algorithm',
    result.integrity.signatureAlgorithm,
  );
  res.setHeader('X-Export-Signature', result.integrity.signature);
  res.setHeader('X-Export-Signer', result.integrity.signerPublicKey);
  res.send(result.content);
}
