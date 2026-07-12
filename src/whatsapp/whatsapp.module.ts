import { Module } from '@nestjs/common';
import { WhatsAppController } from './whatsapp.controller';
import { WhatsAppService } from './whatsapp.service';
import { WHATSAPP_PROVIDER } from './whatsapp.constants';
import { StubWhatsAppProvider } from './stub-whatsapp.provider';

@Module({
  controllers: [WhatsAppController],
  providers: [
    WhatsAppService,
    { provide: WHATSAPP_PROVIDER, useClass: StubWhatsAppProvider },
  ],
  exports: [WhatsAppService, WHATSAPP_PROVIDER],
})
export class WhatsAppModule {}
