import { ExceptionFilter, Catch, ArgumentsHost, HttpStatus, HttpException, UnauthorizedException } from '@nestjs/common';
import { Response } from 'express';

/**
 * Global exception filter for handling 401 Unauthorized responses.
 * Returns a standardized response with WALLET_SESSION_EXPIRED code
 * when JWT validation fails or session is invalid.
 */
@Catch(UnauthorizedException)
export class UnauthorizedExceptionFilter implements ExceptionFilter {
  catch(exception: UnauthorizedException, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    
    res.status(HttpStatus.UNAUTHORIZED).json({
      statusCode: HttpStatus.UNAUTHORIZED,
      error: 'WALLET_SESSION_EXPIRED',
      message: exception.getResponse()?.['message'] ?? 'Wallet session has expired or is invalid',
    });
  }
}
