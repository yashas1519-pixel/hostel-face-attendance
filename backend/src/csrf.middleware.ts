import { Injectable, NestMiddleware, ForbiddenException } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

/**
 * CSRF protection via custom header check.
 * Browser CSRF attacks cannot set custom headers.
 * All state-changing API requests must include X-Requested-With: XMLHttpRequest
 * ponytail: double-submit cookie is overkill when SameSite=Lax cookie + custom header check is sufficient
 */
@Injectable()
export class CsrfMiddleware implements NestMiddleware {
  private static readonly SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

  use(req: Request, _res: Response, next: NextFunction) {
    if (CsrfMiddleware.SAFE_METHODS.has(req.method)) return next();
    
    // Skip for mobile app (mobile sends Bearer token, not cookie auth)
    const auth = req.headers['authorization'];
    if (auth?.startsWith('Bearer ')) return next();
    
    // For cookie-authenticated web requests, require custom header
    const requested = req.headers['x-requested-with'];
    if (!requested) throw new ForbiddenException('CSRF check failed: missing X-Requested-With header');
    next();
  }
}
