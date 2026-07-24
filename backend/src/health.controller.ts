import { Controller, Get, Inject } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { DB_TOKEN, type Database } from './db/index.js';
import { sql } from 'drizzle-orm';

@SkipThrottle() // health checks should never be rate-limited
@Controller('health')
export class HealthController {
  constructor(@Inject(DB_TOKEN) private readonly db: Database) {}

  @Get()
  async health() {
    const start = Date.now();
    let dbStatus = 'ok';
    let dbLatencyMs = 0;
    try {
      // Ping the DB with a lightweight query
      await this.db.execute(sql`SELECT 1`);
      dbLatencyMs = Date.now() - start;
    } catch {
      dbStatus = 'error';
    }
    return {
      status: dbStatus === 'ok' ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      uptime: Math.floor(process.uptime()),
      db: { status: dbStatus, latencyMs: dbLatencyMs },
      version: process.env['npm_package_version'] ?? '1.0.0',
    };
  }
}
