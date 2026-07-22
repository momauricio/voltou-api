import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { z } from 'zod';
import { WhatsAppService } from './whatsapp.service';

const createSessionSchema = z.object({
  tenantId: z.string().uuid(),
  storeId: z.string().uuid(),
  label: z.string().min(1).max(80),
});

const tenantBodySchema = z.object({
  tenantId: z.string().uuid(),
});

@Controller('whatsapp')
export class WhatsAppController {
  constructor(private readonly whatsappService: WhatsAppService) {}

  @Public()
  @Get('health')
  health() {
    return this.whatsappService.health();
  }

  /** WAHA → API: mensagens recebidas (e outros eventos filtrados no service). */
  @Public()
  @Post('webhook')
  webhook(@Body() body: unknown) {
    return this.whatsappService.handleWebhook(body);
  }

  @Get('connections')
  list(
    @Query('tenantId') tenantId?: string,
    @Query('storeId') storeId?: string,
  ) {
    if (!tenantId) {
      throw new BadRequestException('tenantId é obrigatório.');
    }
    return this.whatsappService.listConnections(tenantId, storeId);
  }

  @Post('sessions')
  create(@Body() body: unknown) {
    const parsed = createSessionSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.issues.map((i) => i.message).join(', '),
      );
    }
    return this.whatsappService.createSession(parsed.data);
  }

  @Get('sessions/:name')
  getSession(
    @Param('name') name: string,
    @Query('tenantId') tenantId?: string,
  ) {
    if (!tenantId) {
      throw new BadRequestException('tenantId é obrigatório.');
    }
    return this.whatsappService.getSession(tenantId, name);
  }

  @Get('sessions/:name/qr')
  getQr(
    @Param('name') name: string,
    @Query('tenantId') tenantId?: string,
  ) {
    if (!tenantId) {
      throw new BadRequestException('tenantId é obrigatório.');
    }
    return this.whatsappService.getQr(tenantId, name);
  }

  @Post('sessions/:name/disconnect')
  disconnect(@Param('name') name: string, @Body() body: unknown) {
    const parsed = tenantBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException('tenantId é obrigatório.');
    }
    return this.whatsappService.disconnect(parsed.data.tenantId, name);
  }

  @Delete('connections/:id')
  remove(
    @Param('id') id: string,
    @Query('tenantId') tenantId?: string,
  ) {
    if (!tenantId) {
      throw new BadRequestException('tenantId é obrigatório.');
    }
    return this.whatsappService.removeConnection(tenantId, id);
  }
}
