import { Controller, Post, Get, Body, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Auth } from './roles.guard.js';
import type { JwtPayload } from './jwt.strategy.js';
import { AuthService } from './auth.service.js';
import { RegisterDto, LoginDto, RefreshDto } from './auth.dto.js';
import { Response } from 'express';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  // 5 attempts per minute — brute-force protection
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Post('register')
  async register(@Body() dto: RegisterDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.register(dto);
    res.cookie('access_token', result.accessToken, {
      httpOnly: true,
      secure: process.env['NODE_ENV'] === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      path: '/',
    });
    return result;
  }

  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Post('login')
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.login(dto);
    res.cookie('access_token', result.accessToken, {
      httpOnly: true,
      secure: process.env['NODE_ENV'] === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      path: '/',
    });
    return result;
  }

  // Separate throttle for refresh — allow more frequent calls
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @Post('refresh')
  async refresh(@Body() dto: RefreshDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.refresh(dto.refreshToken);
    res.cookie('access_token', result.accessToken, {
      httpOnly: true,
      secure: process.env['NODE_ENV'] === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      path: '/',
    });
    return result;
  }

  @Post('logout')
  @Auth()
  async logout(@Body() dto: RefreshDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.logout(dto.refreshToken);
    res.clearCookie('access_token', { path: '/' });
    return result;
  }

  @Get('me')
  @Auth()
  me(@Req() req: { user: JwtPayload }) {
    return this.auth.getMe(req.user.sub);
  }
}
