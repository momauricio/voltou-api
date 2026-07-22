import { Module } from '@nestjs/common';
import { WhatsAppController } from './whatsapp.controller';
import { WhatsAppService } from './whatsapp.service';
import { WHATSAPP_PROVIDER } from './whatsapp.constants';
import { StubWhatsAppProvider } from './stub-whatsapp.provider';
import { WahaWhatsAppProvider } from './waha-whatsapp.provider';
import { WahaClient } from './waha.client';
import { PrismaModule } from '../prisma/prisma.module';

const useWaha = Boolean(process.env.WAHA_BASE_URL?.trim());

@Module({
  imports: [PrismaModule],
  controllers: [WhatsAppController],
  providers: [
    WhatsAppService,
    WahaClient,
    StubWhatsAppProvider,
    WahaWhatsAppProvider,
    {
      provide: WHATSAPP_PROVIDER,
      useExisting: useWaha ? WahaWhatsAppProvider : StubWhatsAppProvider,
    },
  ],
  exports: [WhatsAppService, WHATSAPP_PROVIDER, WahaClient],
})
export class WhatsAppModule {}
