import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { z } from 'zod';
import { CampaignsService } from './campaigns.service';

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

@Controller('campaigns')
export class CampaignsController {
  constructor(private readonly campaignsService: CampaignsService) {}

  @Public()

  @Get('health')
  health() {
    return this.campaignsService.health();
  }

  @Get()
  list(
    @Query('tenantId') tenantId?: string,
    @Query('storeId') storeId?: string,
  ) {
    if (!tenantId || !storeId) {
      throw new BadRequestException('tenantId e storeId s�o obrigat�rios.');
    }
    return this.campaignsService.list(tenantId, storeId);
  }

  @Post()
  create(@Body() body: unknown) {
    const parsed = createCampaignSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.issues.map((i) => i.message).join(', '),
      );
    }
    return this.campaignsService.create(parsed.data);
  }

  @Get('messages')
  listMessages(
    @Query('tenantId') tenantId?: string,
    @Query('storeId') storeId?: string,
    @Query('status') status?: string,
    @Query('campaignId') campaignId?: string,
  ) {
    if (!tenantId || !storeId) {
      throw new BadRequestException('tenantId e storeId s�o obrigat�rios.');
    }
    return this.campaignsService.listMessages(
      tenantId,
      storeId,
      status,
      campaignId,
    );
  }

  @Post('messages/:id/approve')
  approve(@Param('id') id: string, @Body() body: { tenantId?: string }) {
    if (!body?.tenantId) {
      throw new BadRequestException('tenantId � obrigat�rio.');
    }
    return this.campaignsService.approveMessage(body.tenantId, id);
  }

  @Post('messages/:id/reject')
  reject(@Param('id') id: string, @Body() body: { tenantId?: string }) {
    if (!body?.tenantId) {
      throw new BadRequestException('tenantId � obrigat�rio.');
    }
    return this.campaignsService.rejectMessage(body.tenantId, id);
  }

  @Post('approve-all')
  approveAll(
    @Body() body: { tenantId?: string; storeId?: string; campaignId?: string },
  ) {
    if (!body?.tenantId || !body?.storeId) {
      throw new BadRequestException('tenantId e storeId s�o obrigat�rios.');
    }
    return this.campaignsService.approveAll(
      body.tenantId,
      body.storeId,
      body.campaignId,
    );
  }
}
