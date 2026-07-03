import { Controller, Post, Get, Body, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Auth } from './roles.guard.js';
import type { JwtPayload } from './jwt.strategy.js';
import { AuthService } from './auth.service.js';
import { RegisterDto, LoginDto, RefreshDto } from './auth.dto.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  // 5 attempts per minute — brute-force protection
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  // Separate throttle for refresh — allow more frequent calls
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  @Post('refresh')
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Post('logout')
  @Auth()
  logout(@Body() dto: RefreshDto) {
    return this.auth.logout(dto.refreshToken);
  }

  @Get('me')
  @Auth()
  me(@Req() req: { user: JwtPayload }) {
    return this.auth.getMe(req.user.sub);
  }
}
