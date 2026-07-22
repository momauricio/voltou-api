import { Module } from '@nestjs/common';
import { BlingClient } from './bling.client';
import { BlingController } from './bling.controller';
import { BlingService } from './bling.service';

@Module({
  controllers: [BlingController],
  providers: [BlingClient, BlingService],
  exports: [BlingService],
})
export class BlingModule {}
