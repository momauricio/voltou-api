import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  SendMessageParams,
  SendMessageResult,
  WhatsAppProvider,
} from './whatsapp-provider.interface';
import { WahaClient } from './waha.client';

function digitsOnly(phone: string): string {
  let digits = phone.replace(/\D/g, '');
  if (!digits.startsWith('55') && digits.length <= 11) {
    digits = `55${digits}`;
  }
  return digits;
}

function toChatId(phone: string): string {
  return `${digitsOnly(phone)}@c.us`;
}

@Injectable()
export class WahaWhatsAppProvider implements WhatsAppProvider {
  constructor(
    private readonly waha: WahaClient,
    private readonly prisma: PrismaService,
  ) {}

  async sendMessage(params: SendMessageParams): Promise<SendMessageResult> {
    const connection = await this.prisma.whatsAppConnection.findFirst({
      where: {
        tenantId: params.tenantId,
        storeId: params.storeId,
        status: 'WORKING',
        provider: 'waha',
      },
      orderBy: { updatedAt: 'desc' },
    });

    if (!connection) {
      throw new Error(
        'Nenhuma sessão WhatsApp WORKING para esta loja. Conecte um número no painel.',
      );
    }

    let chatId = toChatId(params.to);
    try {
      const exists = await this.waha.checkExists({
        session: connection.sessionName,
        phone: digitsOnly(params.to),
      });
      if (!exists.numberExists) {
        throw new Error(
          'Este número não tem WhatsApp (ou está inválido). Confira DDD e dígitos.',
        );
      }
      if (exists.chatId) {
        chatId = exists.chatId;
      }
    } catch (err) {
      // Se check-exists falhar por engate antigo, ainda tenta @c.us
      if (err instanceof Error && err.message.includes('não tem WhatsApp')) {
        throw err;
      }
    }

    const result = await this.waha.sendText({
      session: connection.sessionName,
      chatId,
      text: params.body,
    });

    return {
      messageId:
        result.messageId ??
        result.id ??
        `waha-${connection.sessionName}-${Date.now()}`,
      chatId,
    };
  }

  verifyWebhook(_payload: unknown, _signature: string): boolean {
    return true;
  }
}
