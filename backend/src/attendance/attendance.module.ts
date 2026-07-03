import { Module } from '@nestjs/common';
import { DatabaseProvider } from '../db/index.js';
import { EnrollmentModule } from '../enrollment/enrollment.module.js';
import { AttendanceController } from './attendance.controller.js';
import { AttendanceService } from './attendance.service.js';

@Module({
  imports: [EnrollmentModule],
  controllers: [AttendanceController],
  providers: [AttendanceService, DatabaseProvider],
})
export class AttendanceModule {}
