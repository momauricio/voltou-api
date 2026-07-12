import { Inject, Injectable } from '@nestjs/common';
import { WHATSAPP_PROVIDER } from './whatsapp.constants';
import type { WhatsAppProvider } from './whatsapp-provider.interface';

@Injectable()
export class WhatsAppService {
  constructor(
    @Inject(WHATSAPP_PROVIDER)
    private readonly provider: WhatsAppProvider,
  ) {}

  health() {
    return { module: 'whatsapp', status: 'ok', provider: 'stub' };
  }

  send(params: Parameters<WhatsAppProvider['sendMessage']>[0]) {
    return this.provider.sendMessage(params);
  }
}
