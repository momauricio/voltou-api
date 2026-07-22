import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { MetricsService } from './metrics.service';

@Controller('metrics')
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  @Get('dashboard')
  dashboard(
    @Query('tenantId') tenantId?: string,
    @Query('storeId') storeId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    if (!tenantId || !storeId) {
      throw new BadRequestException('tenantId e storeId são obrigatórios.');
    }
    return this.metricsService.dashboard(tenantId, storeId, from, to);
  }
}
