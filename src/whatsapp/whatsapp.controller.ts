import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Header,
  Param,
  Post,
  Query,
  Req,
  type RawBodyRequest,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { timingSafeEqual } from 'crypto';
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

const VERIFY_CHALLENGE_RE = /^[A-Za-z0-9_-]{1,256}$/;

/** Lê `hub.<key>` tanto no formato plano (`hub.mode`) quanto aninhado (`hub: { mode }`). */
function hubParam(query: Request['query'], key: string): string | undefined {
  const q = (query ?? {}) as Record<string, unknown>;
  let value = q[`hub.${key}`];
  if (value === undefined && q.hub && typeof q.hub === 'object') {
    value = (q.hub as Record<string, unknown>)[key];
  }
  return typeof value === 'string' ? value : undefined;
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

@Controller('whatsapp')
export class WhatsAppController {
  constructor(private readonly whatsappService: WhatsAppService) {}

  @Public()
  @Get('health')
  health() {
    return this.whatsappService.health();
  }

  /**
   * Verificação estilo Meta (Cloud API): ecoa `hub.challenge` quando
   * `hub.mode=subscribe` e `hub.verify_token` == WHATSAPP_WEBHOOK_VERIFY_TOKEN.
   * O WAHA não usa este GET; existe para provedores estilo Meta e responde 403
   * enquanto a env não estiver configurada.
   */
  @Public()
  @SkipThrottle()
  @Get('webhook')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  verifyWebhook(@Req() req: Request): string {
    const expected = (process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN ?? '').trim();
    const mode = hubParam(req.query, 'mode');
    const token = hubParam(req.query, 'verify_token');
    const challenge = hubParam(req.query, 'challenge');
    if (
      !expected ||
      mode !== 'subscribe' ||
      token === undefined ||
      !safeEqual(token, expected) ||
      challenge === undefined ||
      !VERIFY_CHALLENGE_RE.test(challenge)
    ) {
      throw new ForbiddenException('Verificação do webhook WhatsApp inválida.');
    }
    return challenge;
  }

  /**
   * WAHA → API: mensagens recebidas (e outros eventos filtrados no service).
   * O WAHA assina o corpo cru com HMAC-SHA512 em `X-Webhook-Hmac`; segredo em
   * WHATSAPP_HOOK_HMAC_KEY (ou arquivo /app/.whatsapp-hook-hmac-key, ou
   * WAHA_WEBHOOK_SECRET). Sem segredo em produção → 401. Sem throttle: todo o
   * tráfego WAHA vem de um único IP.
   */
  @Public()
  @SkipThrottle()
  @Post('webhook')
  webhook(@Body() body: unknown, @Req() req: RawBodyRequest<Request>) {
    assertWhatsAppWebhookHmac({ headers: req.headers, rawBody: req.rawBody });
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
