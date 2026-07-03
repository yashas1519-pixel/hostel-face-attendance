import { Module } from '@nestjs/common';
import { DatabaseProvider } from '../db/index.js';
import { HostelController } from './hostel.controller.js';
import { HostelService } from './hostel.service.js';

@Module({
  controllers: [HostelController],
  providers: [HostelService, DatabaseProvider],
})
export class HostelModule {}
