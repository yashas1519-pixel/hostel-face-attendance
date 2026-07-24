import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Auth } from '../auth/roles.guard.js';
import type { JwtPayload } from '../auth/jwt.strategy.js';
import { ConsentService } from './consent.service.js';
import { RecordConsentDto } from './consent.dto.js';
import type { Request } from 'express';

@Controller('consent')
@Throttle({ default: { ttl: 60_000, limit: 10 } })
export class ConsentController {
  constructor(private readonly consentService: ConsentService) {}

  @Post('record')
  @Auth('student')
  record(
    @Body() dto: RecordConsentDto,
    @Req() req: { user: JwtPayload } & Request,
  ) {
    const ip = req.ip;
    const userAgent = req.headers['user-agent'];
    return this.consentService.recordConsent(req.user.sub, dto, ip, userAgent);
  }

  @Get('status')
  @Auth('student')
  status(@Req() req: { user: JwtPayload }) {
    return this.consentService.getConsentStatus(req.user.sub);
  }

  @Delete('withdraw')
  @Auth('student')
  withdraw(@Req() req: { user: JwtPayload }) {
    return this.consentService.withdrawConsent(req.user.sub);
  }
}
