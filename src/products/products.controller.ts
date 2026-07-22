import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { z } from 'zod';
import { ProductsService } from './products.service';
import { createProductSchema, updateProductSchema } from '../shared/schemas';

const aiConfigSchema = z.object({
  tenantId: z.string().uuid(),
  storeId: z.string().uuid(),
  defaultMaxDiscountBps: z.number().int().min(0).max(10000),
});

@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Public()

  @Get('health')
  health() {
    return this.productsService.health();
  }

  @Get()
  list(
    @Query('tenantId') tenantId?: string,
    @Query('storeId') storeId?: string,
  ) {
    if (!tenantId || !storeId) {
      throw new BadRequestException('tenantId e storeId s�o obrigat�rios.');
    }
    return this.productsService.list(tenantId, storeId);
  }

  @Get('sellable')
  sellable(
    @Query('tenantId') tenantId?: string,
    @Query('storeId') storeId?: string,
  ) {
    if (!tenantId || !storeId) {
      throw new BadRequestException('tenantId e storeId s�o obrigat�rios.');
    }
    return this.productsService.getSellableProducts(tenantId, storeId);
  }

  @Post()
  create(@Body() body: unknown) {
    const parsed = createProductSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.issues.map((i) => i.message).join(', '),
      );
    }
    return this.productsService.create(parsed.data);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() body: unknown,
    @Query('tenantId') tenantId?: string,
  ) {
    if (!tenantId) throw new BadRequestException('tenantId � obrigat�rio.');
    const parsed = updateProductSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.issues.map((i) => i.message).join(', '),
      );
    }
    return this.productsService.update(tenantId, id, parsed.data);
  }

  @Post('ai-config')
  setAiConfig(@Body() body: unknown) {
    const parsed = aiConfigSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.issues.map((i) => i.message).join(', '),
      );
    }
    const { tenantId, storeId, defaultMaxDiscountBps } = parsed.data;
    return this.productsService.setAiConfig(tenantId, storeId, {
      defaultMaxDiscountBps,
    });
  }
}
