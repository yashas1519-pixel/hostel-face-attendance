import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

/**
 * Catches all exceptions globally.
 * - Logs full details (including stack traces) server-side only.
 * - Returns only safe, generic messages to the client — never stack traces,
 *   DB error details, or internal field names.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = 'Internal server error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      // class-validator returns { message: string[] } — safe to forward
      if (typeof body === 'object' && body !== null && 'message' in body) {
        message = (body as { message: string | string[] }).message;
      } else {
        message = exception.message;
      }
    } else {
      // Unexpected error — log full stack, return generic message
      this.logger.error(
        `Unhandled exception on ${req.method} ${req.url}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    res.status(status).json({ statusCode: status, message });
  }
}
