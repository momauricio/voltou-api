import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { CampaignsService } from './campaigns.service';
import { decryptPhone } from '../common/phone.util';
import { STORE_RULES_TITLE } from '../stores/stores.service';

const TICK_MS = 60_000;
/** Máx. de envios por loja a cada tick — pacing anti-bloqueio do WhatsApp. */
const MAX_SENDS_PER_STORE_PER_TICK = 2;
/** Checkout pendente há mais de X horas gera lembrete. */
const REMINDER_AFTER_HOURS = 24;

const WEEKDAY_LABEL = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

type Window = { start: string; end: string; days: string[] };

@Injectable()
export class CampaignsScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CampaignsScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsapp: WhatsAppService,
    private readonly campaigns: CampaignsService,
  ) {}

  onModuleInit() {
    if (process.env.DISABLE_CAMPAIGN_SCHEDULER === 'true') {
      this.logger.warn('Agendador de campanhas desativado por env.');
      return;
    }
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.logger.log('Agendador de campanhas ativo (tick 60s).');
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      await this.createCheckoutReminders();
      await this.dispatchApprovedMessages();
    } catch (err) {
      this.logger.error(
        `Erro no tick do agendador: ${err instanceof Error ? err.message : err}`,
      );
    } finally {
      this.running = false;
    }
  }

  private async storeWindow(
    tenantId: string,
    storeId: string,
  ): Promise<Window> {
    const row = await this.prisma.storeKnowledge.findFirst({
      where: { tenantId, storeId, title: STORE_RULES_TITLE },
    });
    const fallback: Window = {
      start: '09:00',
      end: '20:00',
      days: ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'],
    };
    if (!row) return fallback;
    try {
      const rules = JSON.parse(row.content) as {
        horaInicio?: string;
        horaFim?: string;
        diasAtivos?: string[];
      };
      return {
        start: rules.horaInicio || fallback.start,
        end: rules.horaFim || fallback.end,
        days: rules.diasAtivos?.length ? rules.diasAtivos : fallback.days,
      };
    } catch {
      return fallback;
    }
  }

  private isWithinWindow(window: Window, timezone: string) {
    const now = new Date();
    const parts = new Intl.DateTimeFormat('pt-BR', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      weekday: 'short',
    }).formatToParts(now);

    const hour = parts.find((p) => p.type === 'hour')?.value ?? '00';
    const minute = parts.find((p) => p.type === 'minute')?.value ?? '00';
    const hhmm = `${hour}:${minute}`;

    const tzDate = new Date(
      now.toLocaleString('en-US', { timeZone: timezone }),
    );
    const dayLabel = WEEKDAY_LABEL[tzDate.getDay()];

    return (
      window.days.includes(dayLabel) &&
      hhmm >= window.start &&
      hhmm <= window.end
    );
  }

  private async dispatchApprovedMessages() {
    const approved = await this.prisma.outreachMessage.findMany({
      where: { status: 'approved' },
      orderBy: { approvedAt: 'asc' },
      take: 100,
      include: {
        customer: true,
        store: { select: { id: true, timezone: true } },
      },
    });
    if (approved.length === 0) return;

    const sentPerStore = new Map<string, number>();
    const windowCache = new Map<string, { window: Window; open: boolean }>();

    for (const message of approved) {
      const storeKey = `${message.tenantId}:${message.storeId}`;
      const alreadySent = sentPerStore.get(storeKey) ?? 0;
      if (alreadySent >= MAX_SENDS_PER_STORE_PER_TICK) continue;

      let cached = windowCache.get(storeKey);
      if (!cached) {
        const window = await this.storeWindow(message.tenantId, message.storeId);
        cached = {
          window,
          open: this.isWithinWindow(window, message.store.timezone),
        };
        windowCache.set(storeKey, cached);
      }
      if (!cached.open) continue;

      if (message.customer.optedOutAt) {
        await this.prisma.outreachMessage.update({
          where: { id: message.id },
          data: { status: 'rejected', failReason: 'Cliente pediu opt-out' },
        });
        continue;
      }

      if (!message.customer.phoneEnc) {
        await this.prisma.outreachMessage.update({
          where: { id: message.id },
          data: { status: 'failed', failReason: 'Cliente sem telefone válido' },
        });
        continue;
      }

      try {
        const to = decryptPhone(message.customer.phoneEnc);
        const sendResult = await this.whatsapp.send({
          tenantId: message.tenantId,
          storeId: message.storeId,
          to,
          body: message.body,
        });

        await this.prisma.outreachMessage.update({
          where: { id: message.id },
          data: {
            status: 'sent',
            sentAt: new Date(),
            providerMessageId: sendResult.messageId,
            ...(sendResult.chatId ? { externalChatId: sendResult.chatId } : {}),
          },
        });
        await this.prisma.customerEvent.create({
          data: {
            tenantId: message.tenantId,
            storeId: message.storeId,
            customerId: message.customerId,
            type: 'outreach',
            title: 'Mensagem enviada no WhatsApp',
            detail:
              message.body.length > 140
                ? `${message.body.slice(0, 140)}…`
                : message.body,
            metadata: JSON.stringify({
              outreachMessageId: message.id,
              chatId: sendResult.chatId ?? null,
            }),
          },
        });
        sentPerStore.set(storeKey, alreadySent + 1);
      } catch (err) {
        await this.prisma.outreachMessage.update({
          where: { id: message.id },
          data: {
            status: 'failed',
            failReason:
              err instanceof Error ? err.message.slice(0, 300) : 'Falha no envio',
          },
        });
      }
    }
  }

  /** Checkout pendente há mais de 24h vira lembrete aguardando aprovação. */
  private async createCheckoutReminders() {
    const cutoff = new Date(Date.now() - REMINDER_AFTER_HOURS * 60 * 60 * 1000);
    const stale = await this.prisma.checkout.findMany({
      where: {
        status: 'pending',
        reminderAt: null,
        createdAt: { lt: cutoff },
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
      take: 50,
      include: { customer: true },
    });

    for (const checkout of stale) {
      await this.prisma.checkout.update({
        where: { id: checkout.id },
        data: { reminderAt: new Date() },
      });

      if (checkout.customer.optedOutAt) continue;

      const campaign = await this.campaigns.getOrCreateReminderCampaign(
        checkout.tenantId,
        checkout.storeId,
      );
      const firstName = checkout.customer.displayName.split(' ')[0];
      const valor = (checkout.amountCents / 100).toFixed(2).replace('.', ',');
      const body = `Oi ${firstName}! Vi que o seu link de pagamento de ${checkout.productNameSnapshot} (R$ ${valor}) ainda está aberto. Ele pode expirar em breve — finalize por aqui: ${checkout.paymentUrl}`;

      await this.prisma.outreachMessage.create({
        data: {
          tenantId: checkout.tenantId,
          storeId: checkout.storeId,
          campaignId: campaign.id,
          customerId: checkout.customerId,
          channel: 'whatsapp',
          body,
          status: 'pending_approval',
        },
      });

      await this.prisma.customerEvent.create({
        data: {
          tenantId: checkout.tenantId,
          storeId: checkout.storeId,
          customerId: checkout.customerId,
          type: 'note',
          title: 'Lembrete de checkout pendente gerado',
          detail: `${checkout.productNameSnapshot} · aguardando aprovação na fila de campanhas`,
          metadata: JSON.stringify({ checkoutId: checkout.id }),
        },
      });
    }
  }
}
