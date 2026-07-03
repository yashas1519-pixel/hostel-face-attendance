import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module.js';
import { HostelModule } from './hostel/hostel.module.js';
import { EnrollmentModule } from './enrollment/enrollment.module.js';
import { AttendanceModule } from './attendance/attendance.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    AuthModule,
    HostelModule,
    EnrollmentModule,
    AttendanceModule,
  ],
})
export class AppModule {}
