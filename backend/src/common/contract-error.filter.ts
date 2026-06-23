import { ExceptionFilter, Catch, ArgumentsHost, HttpStatus } from '@nestjs/common';
import { Response } from 'express';
import { ContractError, ContractErrorCode } from './contract-error';

const STATUS_MAP: Record<ContractErrorCode, number> = {
  [ContractErrorCode.InsufficientFunds]: HttpStatus.UNPROCESSABLE_ENTITY,
  [ContractErrorCode.InvoiceExpired]: HttpStatus.GONE,
  [ContractErrorCode.DuplicateFunding]: HttpStatus.CONFLICT,
  [ContractErrorCode.Unauthorized]: HttpStatus.FORBIDDEN,
  [ContractErrorCode.InvalidState]: HttpStatus.CONFLICT,
};

@Catch(ContractError)
export class ContractErrorFilter implements ExceptionFilter {
  catch(exception: ContractError, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const statusCode = STATUS_MAP[exception.code] ?? HttpStatus.INTERNAL_SERVER_ERROR;
    res.status(statusCode).json({
      statusCode,
      error: exception.code,
      message: exception.message,
    });
  }
}
