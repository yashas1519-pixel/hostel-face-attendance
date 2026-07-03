import { Module } from '@nestjs/common';
import { LeaveController } from './leave.controller.js';
import { LeaveService } from './leave.service.js';
import { DatabaseProvider } from '../db/index.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [AuthModule],
  controllers: [LeaveController],
  providers: [LeaveService, DatabaseProvider],
})
export class LeaveModule {}
