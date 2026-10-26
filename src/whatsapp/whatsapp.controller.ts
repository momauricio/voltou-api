import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  type RawBodyRequest,
} from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../auth/public.decorator';
import { z } from 'zod';
import { WhatsAppService } from './whatsapp.service';
import { assertWhatsAppWebhookHmac } from './webhook-hmac';

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

  /**
   * WAHA → API: mensagens recebidas (e outros eventos filtrados no service).
   *
   * TODO(mauricio): this mirrors PRODUCTION exactly — only `@Body()` is
   * injected, so `req` and `headers` are always undefined here and rawBody is
   * never available. Result: with WHATSAPP_HOOK_HMAC_KEY / WAHA_WEBHOOK_SECRET
   * set, every WAHA webhook is rejected with 401 ("Assinatura do webhook
   * WhatsApp inválida."), and with no secret + NODE_ENV=production also 401.
   * Prod currently rejects ALL WAHA webhooks. Enabling real HMAC verification
   * (inject `@Req()`/`@Headers()`, configure `hmac.key` on WAHA sessions,
   * maybe `@SkipThrottle()`) is a product decision — it would start
   * processing inbound WhatsApp messages in prod.
   */
  @Public()
  @Post('webhook')
  webhook(
    @Body() body: unknown,
    req?: RawBodyRequest<Request>,
    headers?: Record<string, string | string[] | undefined>,
  ) {
    const h = (req && req.headers) || headers || {};
    assertWhatsAppWebhookHmac({ headers: h, rawBody: req && req.rawBody });
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
