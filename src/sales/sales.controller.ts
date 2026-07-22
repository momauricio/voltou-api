import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
} from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { SalesService } from './sales.service';
import { createSaleSchema } from '../shared/schemas';

@Controller('sales')
export class SalesController {
  constructor(private readonly salesService: SalesService) {}

  @Public()

  @Get('health')
  health() {
    return this.salesService.health();
  }

  @Get()
  list(
    @Query('tenantId') tenantId?: string,
    @Query('storeId') storeId?: string,
  ) {
    if (!tenantId) throw new BadRequestException('tenantId � obrigat�rio.');
    return this.salesService.list(tenantId, storeId);
  }

  @Post()
  create(@Body() body: unknown) {
    const parsed = createSaleSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.issues.map((i) => i.message).join(', '),
      );
    }
    return this.salesService.create(parsed.data);
  }
}
