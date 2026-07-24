import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Request } from 'express';

export interface JwtPayload {
  sub: string;
  email: string;
  role: 'student' | 'admin';
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    const secret = config.getOrThrow<string>('JWT_SECRET');
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        (req: Request) => {
          // Try cookie first (web)
          const cookieToken = (req as any)?.cookies?.['access_token'] as string | undefined;
          if (cookieToken) return cookieToken;
          // Fall back to Bearer header (mobile)
          const auth = req?.headers?.authorization;
          if (auth?.startsWith('Bearer ')) return auth.slice(7);
          return null;
        },
      ]),
      secretOrKey: secret,
    });
  }

  validate(payload: JwtPayload) {
    // ponytail: attach the whole payload as req.user — no DB lookup on every request
    return payload;
  }
}
