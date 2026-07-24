import { Module } from '@nestjs/common';
import { DatabaseProvider } from '../db/index.js';
import { ConsentController } from './consent.controller.js';
import { ConsentService } from './consent.service.js';

@Module({
  controllers: [ConsentController],
  providers: [ConsentService, DatabaseProvider],
  exports: [ConsentService],
})
export class ConsentModule {}
