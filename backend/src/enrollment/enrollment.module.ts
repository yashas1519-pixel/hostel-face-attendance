import { Module } from '@nestjs/common';
import { DatabaseProvider } from '../db/index.js';
import { EnrollmentController } from './enrollment.controller.js';
import { EnrollmentService } from './enrollment.service.js';

@Module({
  controllers: [EnrollmentController],
  providers: [EnrollmentService, DatabaseProvider],
  exports: [EnrollmentService],
})
export class EnrollmentModule {}
