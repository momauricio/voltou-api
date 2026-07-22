import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Post,
  Query,
} from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { z } from 'zod';
import { BlingService } from './bling.service';

const tenantStoreQuery = z.object({
  tenantId: z.string().uuid(),
  storeId: z.string().uuid(),
});

const callbackSchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
});

@Controller('bling')
export class BlingController {
  constructor(private readonly blingService: BlingService) {}

  @Public()

  @Get('health')
  health() {
    return this.blingService.health();
  }

  @Get('authorize-url')
  authorizeUrl(
    @Query('tenantId') tenantId?: string,
    @Query('storeId') storeId?: string,
  ) {
    const parsed = tenantStoreQuery.safeParse({ tenantId, storeId });
    if (!parsed.success) {
      throw new BadRequestException('tenantId e storeId são obrigatórios.');
    }
    return this.blingService.getAuthorizeUrl(
      parsed.data.tenantId,
      parsed.data.storeId,
    );
  }

  @Public()
  @Post('callback')
  callback(@Body() body: unknown) {
    const parsed = callbackSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException('code e state são obrigatórios.');
    }
    return this.blingService.completeOAuth(parsed.data.code, parsed.data.state);
  }

  @Get('connection')
  connection(
    @Query('tenantId') tenantId?: string,
    @Query('storeId') storeId?: string,
  ) {
    const parsed = tenantStoreQuery.safeParse({ tenantId, storeId });
    if (!parsed.success) {
      throw new BadRequestException('tenantId e storeId são obrigatórios.');
    }
    return this.blingService.getConnection(
      parsed.data.tenantId,
      parsed.data.storeId,
    );
  }

  @Delete('connection')
  disconnect(
    @Query('tenantId') tenantId?: string,
    @Query('storeId') storeId?: string,
  ) {
    const parsed = tenantStoreQuery.safeParse({ tenantId, storeId });
    if (!parsed.success) {
      throw new BadRequestException('tenantId e storeId são obrigatórios.');
    }
    return this.blingService.disconnect(
      parsed.data.tenantId,
      parsed.data.storeId,
    );
  }

  @Post('sync')
  sync(@Body() body: unknown) {
    const parsed = tenantStoreQuery.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException('tenantId e storeId são obrigatórios.');
    }
    return this.blingService.sync(parsed.data.tenantId, parsed.data.storeId);
  }
}
