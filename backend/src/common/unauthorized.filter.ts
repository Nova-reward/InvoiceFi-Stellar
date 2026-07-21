import { ExceptionFilter, Catch, ArgumentsHost, HttpStatus, UnauthorizedException } from '@nestjs/common';

/**
 * Global exception filter for handling 401 Unauthorized responses.
 * Returns a standardized response with WALLET_SESSION_EXPIRED code
 * when JWT validation fails or session is invalid.
 */
@Catch(UnauthorizedException)
export class UnauthorizedExceptionFilter implements ExceptionFilter {
  catch(exception: UnauthorizedException, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse();

    const response = exception.getResponse();
    const message =
      typeof response === 'object' && response !== null && 'message' in response
        ? (response as { message?: unknown }).message
        : response;

    res.status(HttpStatus.UNAUTHORIZED).json({
      statusCode: HttpStatus.UNAUTHORIZED,
      error: 'WALLET_SESSION_EXPIRED',
      message: message ?? 'Wallet session has expired or is invalid',
    });
  }
}
