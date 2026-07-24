import { Module } from '@nestjs/common';
import { WardenController } from './warden.controller.js';
import { WardenService } from './warden.service.js';
import { DatabaseProvider } from '../db/index.js';

@Module({
  controllers: [WardenController],
  providers: [WardenService, DatabaseProvider],
})
export class WardenModule {}
