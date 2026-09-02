import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WahaClient } from './waha.client';
import { WHATSAPP_PROVIDER } from './whatsapp.constants';
import type { WhatsAppProvider } from './whatsapp-provider.interface';
import { Inject } from '@nestjs/common';
import { hashPhone, normalizePhoneBr } from '../common/phone.util';
import { resolveWhatsAppWebhookSecret } from './webhook-hmac';

function mapUiStatus(status: string): 'Conectado' | 'Aguardando' | 'Desconectado' {
  if (status === 'WORKING') return 'Conectado';
  if (status === 'SCAN_QR_CODE' || status === 'STARTING') return 'Aguardando';
  return 'Desconectado';
}

function phoneFromMe(me?: { id?: string } | null): string | null {
  if (!me?.id) return null;
  const digits = me.id.replace(/@c\.us$/i, '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length >= 12 && digits.startsWith('55')) {
    return `+${digits.slice(0, 2)} ${digits.slice(2, 4)} ${digits.slice(4)}`;
  }
  return `+${digits}`;
}

function phoneHashVariants(digits: string): string[] {
  const cleaned = digits.replace(/\D/g, '');
  const candidates = new Set<string>();
  candidates.add(cleaned);
  if (cleaned.startsWith('55')) {
    candidates.add(cleaned.slice(2));
  } else if (cleaned.length >= 10 && cleaned.length <= 11) {
    candidates.add(`55${cleaned}`);
  }
  for (const d of [...candidates]) {
    const local = d.startsWith('55') ? d.slice(2) : d;
    if (local.length === 11 && local[2] === '9') {
      const withoutNine = `${local.slice(0, 2)}${local.slice(3)}`;
      candidates.add(d.startsWith('55') ? `55${withoutNine}` : withoutNine);
    }
    if (local.length === 10) {
      const withNine = `${local.slice(0, 2)}9${local.slice(2)}`;
      candidates.add(d.startsWith('55') ? `55${withNine}` : withNine);
    }
  }
  return [...candidates].map((d) => hashPhone(normalizePhoneBr(d)));
}

@Injectable()
export class WhatsAppService implements OnModuleInit {
  private readonly logger = new Logger(WhatsAppService.name);

  constructor(
    @Inject(WHATSAPP_PROVIDER)
    private readonly provider: WhatsAppProvider,
    private readonly waha: WahaClient,
    private readonly prisma: PrismaService,
  ) {}

  async onModuleInit() {
    if (!this.waha.configured) return;
    try {
      const res = await this.ensureAllSessionWebhooks();
      this.logger.log(`Webhooks WAHA sincronizados: ${res.updated} sessão(ões).`);
    } catch (err) {
      this.logger.warn(
        `Falha ao configurar webhooks WAHA: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  health() {
    return {
      module: 'whatsapp',
      status: 'ok',
      provider: this.waha.configured ? 'waha' : 'stub',
      wahaConfigured: this.waha.configured,
    };
  }

  send(params: Parameters<WhatsAppProvider['sendMessage']>[0]) {
    return this.provider.sendMessage(params);
  }

  private webhookUrl(): string | null {
    const base = (process.env.API_PUBLIC_URL ?? '').trim().replace(/\/$/, '');
    if (!base) return null;
    return `${base}/whatsapp/webhook`;
  }

  private webhookConfig() {
    const url = this.webhookUrl();
    if (!url) return undefined;
    const hmacKey = resolveWhatsAppWebhookSecret();
    return {
      webhooks: [
        {
          url,
          events: ['message'],
          ...(hmacKey ? { hmac: { key: hmacKey } } : {}),
        },
      ],
    };
  }

  /** Garante que a sessão WAHA posta eventos de mensagem para a API. */
  async ensureSessionWebhook(sessionName: string) {
    const config = this.webhookConfig();
    if (!config || !this.waha.configured) return { ok: false, reason: 'not_configured' };
    await this.waha.updateSession(sessionName, config);
    return { ok: true, url: config.webhooks[0].url };
  }

  async ensureAllSessionWebhooks() {
    if (!this.waha.configured) return { updated: 0 };
    const rows = await this.prisma.whatsAppConnection.findMany({
      where: { provider: 'waha' },
    });
    let updated = 0;
    for (const row of rows) {
      try {
        await this.ensureSessionWebhook(row.sessionName);
        updated += 1;
      } catch {
        /* sessão pode estar offline */
      }
    }
    return { updated };
  }

  /**
   * Webhook WAHA: mensagem recebida do cliente.
   * Casa por telefone (@c.us) ou pelo chatId (@lid) da última outreach enviada.
   */
  async handleWebhook(body: unknown) {
    const event = body as {
      event?: string;
      session?: string;
      payload?: {
        id?: string;
        from?: string;
        fromMe?: boolean;
        body?: string;
        hasMedia?: boolean;
        timestamp?: number;
      };
    };

    if (event.event !== 'message') {
      return { ignored: true, reason: 'not_message' };
    }

    const payload = event.payload;
    if (!payload || payload.fromMe) {
      return { ignored: true, reason: 'from_me_or_empty' };
    }

    const sessionName = event.session;
    if (!sessionName) {
      return { ignored: true, reason: 'no_session' };
    }

    const connection = await this.prisma.whatsAppConnection.findFirst({
      where: { sessionName, provider: 'waha' },
    });
    if (!connection) {
      return { ignored: true, reason: 'unknown_session' };
    }

    const from = payload.from ?? '';
    const hasText = Boolean((payload.body ?? '').trim());
    const hasMedia = Boolean(payload.hasMedia);
    if (!hasText && !hasMedia) {
      return { ignored: true, reason: 'empty_body' };
    }

    const messageId = payload.id ?? '';
    if (messageId) {
      const dup = await this.prisma.customerEvent.findFirst({
        where: {
          tenantId: connection.tenantId,
          storeId: connection.storeId,
          type: 'reply',
          metadata: { contains: messageId },
        },
      });
      if (dup) {
        return { ignored: true, reason: 'duplicate' };
      }
    }

    const customer = await this.resolveCustomerFromInbound({
      tenantId: connection.tenantId,
      storeId: connection.storeId,
      from,
    });

    if (!customer) {
      return { ignored: true, reason: 'customer_not_found', from };
    }

    const occurredAt = payload.timestamp
      ? new Date(payload.timestamp * 1000)
      : new Date();

    const outreach = await this.prisma.outreachMessage.findFirst({
      where: {
        tenantId: connection.tenantId,
        storeId: connection.storeId,
        customerId: customer.id,
        status: 'sent',
        repliedAt: null,
      },
      orderBy: { sentAt: 'desc' },
    });

    // Já respondeu a um disparo: só marca chatId se faltar — sem novo evento/texto
    if (!outreach) {
      const alreadyReplied = await this.prisma.outreachMessage.findFirst({
        where: {
          tenantId: connection.tenantId,
          storeId: connection.storeId,
          customerId: customer.id,
          status: 'sent',
          repliedAt: { not: null },
        },
      });
      if (alreadyReplied) {
        if (from && !alreadyReplied.externalChatId) {
          await this.prisma.outreachMessage.update({
            where: { id: alreadyReplied.id },
            data: { externalChatId: from },
          });
        }
        return {
          ok: true,
          customerId: customer.id,
          alreadyCounted: true,
        };
      }
    }

    await this.prisma.customerEvent.create({
      data: {
        tenantId: connection.tenantId,
        storeId: connection.storeId,
        customerId: customer.id,
        type: 'reply',
        title: 'Cliente respondeu no WhatsApp',
        detail: null,
        metadata: JSON.stringify({
          whatsappMessageId: messageId || null,
          from,
          session: sessionName,
          // não persiste o texto da mensagem (privacidade / UX do painel)
        }),
        occurredAt,
      },
    });

    if (outreach) {
      await this.prisma.outreachMessage.update({
        where: { id: outreach.id },
        data: {
          repliedAt: occurredAt,
          replyPreview: null,
          ...(from ? { externalChatId: from } : {}),
        },
      });
    } else if (from) {
      await this.prisma.outreachMessage.updateMany({
        where: {
          tenantId: connection.tenantId,
          storeId: connection.storeId,
          customerId: customer.id,
          status: 'sent',
          externalChatId: null,
        },
        data: { externalChatId: from },
      });
    }

    return {
      ok: true,
      customerId: customer.id,
    };
  }

  private async resolveCustomerFromInbound(params: {
    tenantId: string;
    storeId: string;
    from: string;
  }) {
    const { tenantId, storeId, from } = params;

    // 1) Match por chatId LID / JID já usado no envio
    if (from) {
      const byChat = await this.prisma.outreachMessage.findFirst({
        where: {
          tenantId,
          storeId,
          externalChatId: from,
          status: 'sent',
        },
        orderBy: { sentAt: 'desc' },
        include: { customer: true },
      });
      if (byChat?.customer) return byChat.customer;
    }

    // 2) Match por telefone @c.us / @s.whatsapp.net
    const digits = from.replace(/@.*$/, '').replace(/\D/g, '');
    if (digits.length >= 10 && !from.includes('@lid')) {
      const variants = phoneHashVariants(digits);
      for (const hash of variants) {
        const customer = await this.prisma.customer.findFirst({
          where: { tenantId, storeId, phoneHash: hash },
        });
        if (customer) return customer;
      }
    }

    // 3) Fallback: único cliente com outreach enviada sem resposta nesta loja
    const pending = await this.prisma.outreachMessage.findMany({
      where: {
        tenantId,
        storeId,
        status: 'sent',
        repliedAt: null,
      },
      orderBy: { sentAt: 'desc' },
      take: 5,
      include: { customer: true },
    });
    if (pending.length === 1) return pending[0].customer;

    return null;
  }

  async listConnections(tenantId: string, storeId?: string) {
    const rows = await this.prisma.whatsAppConnection.findMany({
      where: {
        tenantId,
        ...(storeId ? { storeId } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!this.waha.configured) {
      return rows.map((row) => ({
        id: row.id,
        label: row.label,
        sessionName: row.sessionName,
        status: row.status,
        uiStatus: mapUiStatus(row.status),
        phoneE164: row.phoneE164,
        provider: row.provider,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      }));
    }

    const synced = await Promise.all(
      rows.map(async (row) => {
        try {
          const session = await this.waha.getSession(row.sessionName);
          const phoneE164 = phoneFromMe(session.me) ?? row.phoneE164;
          if (session.status !== row.status || phoneE164 !== row.phoneE164) {
            await this.prisma.whatsAppConnection.update({
              where: { id: row.id },
              data: { status: session.status, phoneE164 },
            });
          }
          return {
            id: row.id,
            label: row.label,
            sessionName: row.sessionName,
            status: session.status,
            uiStatus: mapUiStatus(session.status),
            phoneE164,
            provider: row.provider,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
          };
        } catch {
          return {
            id: row.id,
            label: row.label,
            sessionName: row.sessionName,
            status: row.status,
            uiStatus: mapUiStatus(row.status),
            phoneE164: row.phoneE164,
            provider: row.provider,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
          };
        }
      }),
    );

    return synced;
  }

  async createSession(input: {
    tenantId: string;
    storeId: string;
    label: string;
  }) {
    if (!this.waha.configured) {
      throw new ServiceUnavailableException(
        'Conexão WhatsApp indisponível no momento. Tente novamente em breve.',
      );
    }

    const store = await this.prisma.store.findFirst({
      where: { id: input.storeId, tenantId: input.tenantId },
    });
    if (!store) {
      throw new BadRequestException('Loja não encontrada para este tenant.');
    }

    const shortId = crypto.randomUUID().replace(/-/g, '').slice(0, 8);
    const sessionName = `voltou_${input.storeId.slice(0, 8)}_${shortId}`.replace(
      /[^a-zA-Z0-9_]/g,
      '_',
    );

    const session = await this.waha.createSession(
      sessionName,
      this.webhookConfig(),
    );

    const row = await this.prisma.whatsAppConnection.create({
      data: {
        tenantId: input.tenantId,
        storeId: input.storeId,
        label: input.label.trim(),
        sessionName,
        provider: 'waha',
        status: session.status ?? 'STARTING',
      },
    });

    return {
      id: row.id,
      label: row.label,
      sessionName: row.sessionName,
      status: row.status,
      uiStatus: mapUiStatus(row.status),
      phoneE164: row.phoneE164,
    };
  }

  async getSession(tenantId: string, sessionName: string) {
    const row = await this.requireConnection(tenantId, sessionName);

    if (!this.waha.configured) {
      return {
        id: row.id,
        label: row.label,
        sessionName: row.sessionName,
        status: row.status,
        uiStatus: mapUiStatus(row.status),
        phoneE164: row.phoneE164,
      };
    }

    const session = await this.waha.getSession(sessionName);
    const phoneE164 = phoneFromMe(session.me) ?? row.phoneE164;

    const updated = await this.prisma.whatsAppConnection.update({
      where: { id: row.id },
      data: { status: session.status, phoneE164 },
    });

    return {
      id: updated.id,
      label: updated.label,
      sessionName: updated.sessionName,
      status: updated.status,
      uiStatus: mapUiStatus(updated.status),
      phoneE164: updated.phoneE164,
      me: session.me ?? null,
    };
  }

  async getQr(tenantId: string, sessionName: string) {
    await this.requireConnection(tenantId, sessionName);
    if (!this.waha.configured) {
      throw new ServiceUnavailableException(
        'Conexão WhatsApp indisponível no momento. Tente novamente em breve.',
      );
    }

    const qr = await this.waha.getQr(sessionName);
    return {
      mimetype: qr.mimetype || 'image/png',
      data: qr.data,
    };
  }

  async disconnect(tenantId: string, sessionName: string) {
    const row = await this.requireConnection(tenantId, sessionName);

    if (this.waha.configured) {
      try {
        await this.waha.logoutSession(sessionName);
      } catch {
        /* session may already be logged out */
      }
      try {
        await this.waha.deleteSession(sessionName);
      } catch {
        /* ignore */
      }
    }

    const updated = await this.prisma.whatsAppConnection.update({
      where: { id: row.id },
      data: { status: 'STOPPED', phoneE164: null },
    });

    return {
      id: updated.id,
      sessionName: updated.sessionName,
      status: updated.status,
      uiStatus: mapUiStatus(updated.status),
    };
  }

  async removeConnection(tenantId: string, id: string) {
    const row = await this.prisma.whatsAppConnection.findFirst({
      where: { id, tenantId },
    });
    if (!row) {
      throw new NotFoundException('Conexão não encontrada.');
    }

    if (this.waha.configured) {
      try {
        await this.waha.logoutSession(row.sessionName);
      } catch {
        /* ignore */
      }
      try {
        await this.waha.deleteSession(row.sessionName);
      } catch {
        /* ignore */
      }
    }

    await this.prisma.whatsAppConnection.delete({ where: { id: row.id } });
    return { ok: true };
  }

  private async requireConnection(tenantId: string, sessionName: string) {
    const row = await this.prisma.whatsAppConnection.findFirst({
      where: { tenantId, sessionName },
    });
    if (!row) {
      throw new NotFoundException('Sessão não encontrada.');
    }
    return row;
  }
}
