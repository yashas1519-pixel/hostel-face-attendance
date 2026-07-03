import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { AuthModule } from './auth/auth.module.js';
import { HostelModule } from './hostel/hostel.module.js';
import { EnrollmentModule } from './enrollment/enrollment.module.js';
import { AttendanceModule } from './attendance/attendance.module.js';
import { LeaveModule } from './leave/leave.module.js';
import { HealthController } from './health.controller.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Rate limiting: 60 requests per minute globally; auth routes override to 5/min
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 60 }]),
    AuthModule,
    HostelModule,
    EnrollmentModule,
    AttendanceModule,
    LeaveModule,
  ],
  controllers: [HealthController],
  providers: [
    // Apply throttler globally — individual routes can use @Throttle() to override
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
