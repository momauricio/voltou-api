import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { Public } from '../auth/public.decorator';
import { CampaignsService } from '../campaigns/campaigns.service';
import { StoresService } from '../stores/stores.service';
import { InternalApiKeyGuard } from './internal-api-key.guard';

const createCampaignSchema = z.object({
  tenantId: z.string().uuid(),
  storeId: z.string().uuid(),
  name: z.string().trim().min(2).max(120),
  segment: z.enum([
    'checkout_pendente',
    'interesse_aberto',
    'inativos',
    'sem_compra',
    'todos',
  ]),
  messageTemplate: z.string().trim().min(5).max(2000),
  autoApprove: z.boolean().optional(),
});

@Public()
@UseGuards(InternalApiKeyGuard)
@Controller('internal')
export class InternalController {
  constructor(
    private readonly stores: StoresService,
    private readonly campaigns: CampaignsService,
  ) {}

  @Get('stores/active')
  listActiveStores() {
    return this.stores.listActiveStores();
  }

  @Get('stores/context')
  getStoreContext(
    @Query('tenantId') tenantId?: string,
    @Query('storeId') storeId?: string,
  ) {
    if (!tenantId || !storeId) {
      throw new BadRequestException('tenantId e storeId são obrigatórios.');
    }
    return this.stores.getStoreContext(tenantId, storeId);
  }

  @Post('campaigns')
  createCampaign(@Body() body: unknown) {
    const parsed = createCampaignSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.issues.map((i) => i.message).join(', '),
      );
    }
    return this.campaigns.create(parsed.data);
  }
}
