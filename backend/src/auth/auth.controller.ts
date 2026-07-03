import { Controller, Post, Get, Body, Req } from '@nestjs/common';
import { Auth } from './roles.guard.js';
import type { JwtPayload } from './jwt.strategy.js';
import { AuthService } from './auth.service.js';
import { RegisterDto, LoginDto } from './auth.dto.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @Get('me')
  @Auth()
  me(@Req() req: { user: JwtPayload }) {
    return this.auth.getMe(req.user.sub);
  }
}
