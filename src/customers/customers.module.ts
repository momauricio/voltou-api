import { Module } from '@nestjs/common';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';
import { SegmentsService } from './segments.service';

@Module({
  controllers: [CustomersController],
  providers: [CustomersService, SegmentsService],
  exports: [CustomersService, SegmentsService],
})
export class CustomersModule {}
