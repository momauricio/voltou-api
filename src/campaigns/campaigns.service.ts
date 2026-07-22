import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  SegmentsService,
  type SegmentId,
} from '../customers/segments.service';

export type CreateCampaignInput = {
  tenantId: string;
  storeId: string;
  name: string;
  segment: SegmentId | 'todos';
  messageTemplate: string;
  autoApprove?: boolean;
};

const SYSTEM_REMINDER_CAMPAIGN = 'Lembretes de checkout pendente';

@Injectable()
export class CampaignsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly segments: SegmentsService,
  ) {}

  health() {
    return { module: 'campaigns', status: 'ok' };
  }

  renderTemplate(
    template: string,
    vars: { nome: string; produto?: string | null; link?: string | null },
  ) {
    return template
      .replaceAll('{{nome}}', vars.nome)
      .replaceAll('{{produto}}', vars.produto ?? 'aquele produto que você viu')
      .replaceAll('{{link}}', vars.link ?? '');
  }

  async list(tenantId: string, storeId: string) {
    const campaigns = await this.prisma.campaign.findMany({
      where: { tenantId, storeId },
      orderBy: { createdAt: 'desc' },
      include: {
        outreachMessages: {
          select: { status: true, repliedAt: true },
        },
      },
    });

    return campaigns.map((c) => {
      const byStatus = (s: string) =>
        c.outreachMessages.filter((m) => m.status === s).length;
      return {
        id: c.id,
        name: c.name,
        status: c.status,
        kind: c.kind,
        segment: c.segment,
        messageTemplate: c.messageTemplate,
        createdAt: c.createdAt,
        counts: {
          total: c.outreachMessages.length,
          pendingApproval: byStatus('pending_approval'),
          approved: byStatus('approved'),
          sent: byStatus('sent'),
          replied: c.outreachMessages.filter((m) => m.repliedAt != null).length,
          rejected: byStatus('rejected'),
          failed: byStatus('failed'),
        },
      };
    });
  }

  /** Cria a campanha e gera mensagens pendentes de aprovação para o segmento. */
  async create(input: CreateCampaignInput) {
    if (!input.messageTemplate.trim()) {
      throw new BadRequestException('Informe a mensagem da campanha.');
    }

    const eligible = await this.segments.eligibleForSegment(
      input.tenantId,
      input.storeId,
      input.segment,
    );
    if (eligible.length === 0) {
      throw new BadRequestException(
        'Nenhum cliente elegível neste segmento agora (opt-out e contatos recentes são respeitados).',
      );
    }

    const initialStatus = input.autoApprove ? 'approved' : 'pending_approval';

    const campaign = await this.prisma.campaign.create({
      data: {
        tenantId: input.tenantId,
        storeId: input.storeId,
        name: input.name,
        status: input.autoApprove ? 'active' : 'awaiting_approval',
        segment: input.segment,
        messageTemplate: input.messageTemplate,
        kind: 'manual',
      },
    });

    const needsLink = input.messageTemplate.includes('{{link}}');
    const linkByCustomer = new Map<string, string>();
    if (needsLink) {
      const checkouts = await this.prisma.checkout.findMany({
        where: {
          tenantId: input.tenantId,
          storeId: input.storeId,
          customerId: { in: eligible.map((c) => c.customerId) },
          status: 'pending',
          couponCode: { not: null },
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        orderBy: { createdAt: 'desc' },
        select: { customerId: true, paymentUrl: true },
      });
      for (const row of checkouts) {
        if (!linkByCustomer.has(row.customerId)) {
          linkByCustomer.set(row.customerId, row.paymentUrl);
        }
      }
    }

    await this.prisma.outreachMessage.createMany({
      data: eligible.map((c) => ({
        tenantId: input.tenantId,
        storeId: input.storeId,
        campaignId: campaign.id,
        customerId: c.customerId,
        channel: 'whatsapp',
        body: this.renderTemplate(input.messageTemplate, {
          nome: c.displayName.split(' ')[0],
          produto: c.productName,
          link: linkByCustomer.get(c.customerId) ?? null,
        }),
        status: initialStatus,
        ...(input.autoApprove ? { approvedAt: new Date() } : {}),
      })),
    });

    return {
      id: campaign.id,
      name: campaign.name,
      status: campaign.status,
      messagesCreated: eligible.length,
    };
  }

  async listMessages(
    tenantId: string,
    storeId: string,
    status?: string,
    campaignId?: string,
  ) {
    const messages = await this.prisma.outreachMessage.findMany({
      where: {
        tenantId,
        storeId,
        ...(status ? { status } : {}),
        ...(campaignId ? { campaignId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        customer: {
          select: { id: true, displayName: true, phoneMasked: true, optedOutAt: true },
        },
        campaign: { select: { id: true, name: true, kind: true, segment: true } },
      },
    });

    return messages.map((m) => ({
      id: m.id,
      body: m.body,
      status: m.status,
      failReason: m.failReason,
      createdAt: m.createdAt,
      approvedAt: m.approvedAt,
      sentAt: m.sentAt,
      customer: {
        id: m.customer.id,
        displayName: m.customer.displayName,
        phoneMasked: m.customer.phoneMasked,
        optedOut: m.customer.optedOutAt != null,
      },
      campaign: m.campaign,
    }));
  }

  private async findMessage(tenantId: string, messageId: string) {
    const message = await this.prisma.outreachMessage.findFirst({
      where: { id: messageId, tenantId },
    });
    if (!message) throw new NotFoundException('Mensagem não encontrada.');
    return message;
  }

  async approveMessage(tenantId: string, messageId: string) {
    const message = await this.findMessage(tenantId, messageId);
    if (message.status !== 'pending_approval') {
      throw new BadRequestException('Mensagem não está aguardando aprovação.');
    }
    return this.prisma.outreachMessage.update({
      where: { id: messageId },
      data: { status: 'approved', approvedAt: new Date() },
    });
  }

  async rejectMessage(tenantId: string, messageId: string) {
    const message = await this.findMessage(tenantId, messageId);
    if (message.status !== 'pending_approval') {
      throw new BadRequestException('Mensagem não está aguardando aprovação.');
    }
    return this.prisma.outreachMessage.update({
      where: { id: messageId },
      data: { status: 'rejected' },
    });
  }

  async approveAll(tenantId: string, storeId: string, campaignId?: string) {
    const result = await this.prisma.outreachMessage.updateMany({
      where: {
        tenantId,
        storeId,
        status: 'pending_approval',
        ...(campaignId ? { campaignId } : {}),
      },
      data: { status: 'approved', approvedAt: new Date() },
    });
    return { approved: result.count };
  }

  /** Campanha de sistema para lembretes automáticos (criada sob demanda). */
  async getOrCreateReminderCampaign(tenantId: string, storeId: string) {
    const existing = await this.prisma.campaign.findFirst({
      where: { tenantId, storeId, kind: 'system', name: SYSTEM_REMINDER_CAMPAIGN },
    });
    if (existing) return existing;
    return this.prisma.campaign.create({
      data: {
        tenantId,
        storeId,
        name: SYSTEM_REMINDER_CAMPAIGN,
        status: 'active',
        kind: 'system',
        segment: 'checkout_pendente',
      },
    });
  }
}
