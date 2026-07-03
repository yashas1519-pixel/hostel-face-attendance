import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';

@SkipThrottle() // health checks should never be rate-limited
@Controller('health')
export class HealthController {
  @Get()
  check() {
    return { status: 'ok', ts: new Date().toISOString() };
  }
}
