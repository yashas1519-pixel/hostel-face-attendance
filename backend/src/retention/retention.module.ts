import { Module } from '@nestjs/common';
import { RetentionService } from './retention.service.js';

@Module({
  providers: [RetentionService],
})
export class RetentionModule {}
