import { Injectable } from '@nestjs/common';
import {
  SendMessageParams,
  WhatsAppProvider,
} from './whatsapp-provider.interface';

/** Stub BSP adapter — replace with Meta Cloud API / partner BSP. */
@Injectable()
export class StubWhatsAppProvider implements WhatsAppProvider {
  async sendMessage(params: SendMessageParams): Promise<{ messageId: string; chatId?: string }> {
    return { messageId: `stub-${params.tenantId}-${Date.now()}` };
  }

  verifyWebhook(_payload: unknown, _signature: string): boolean {
    return true;
  }
}
