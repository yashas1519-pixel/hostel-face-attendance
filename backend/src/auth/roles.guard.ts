import {
  Injectable,
  CanActivate,
  ExecutionContext,
  SetMetadata,
  applyDecorators,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import type { JwtPayload } from './jwt.strategy.js';

const ROLES_KEY = 'roles';

/** Combined JWT + role guard. */
@Injectable()
export class RolesGuard extends AuthGuard('jwt') implements CanActivate {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    // Run JWT auth first
    const jwtOk = await (super.canActivate(ctx) as Promise<boolean>);
    if (!jwtOk) return false;

    const requiredRoles = this.reflector.getAllAndOverride<string[] | undefined>(
      ROLES_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (!requiredRoles || requiredRoles.length === 0) return true;

    const user = ctx.switchToHttp().getRequest<{ user: JwtPayload }>().user;
    if (!requiredRoles.includes(user.role)) {
      throw new ForbiddenException('Insufficient role');
    }
    return true;
  }
}

/**
 * Decorator: protect a route with JWT + optional role check.
 * Usage: @Auth('admin') or @Auth() for any authenticated user.
 */
export function Auth(...roles: string[]) {
  return applyDecorators(
    SetMetadata(ROLES_KEY, roles),
    UseGuards(RolesGuard),
  );
}
