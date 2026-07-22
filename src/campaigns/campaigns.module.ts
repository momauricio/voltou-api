import { Module } from '@nestjs/common';
import { CampaignsController } from './campaigns.controller';
import { CampaignsService } from './campaigns.service';
import { CampaignsScheduler } from './campaigns.scheduler';
import { CustomersModule } from '../customers/customers.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';

@Module({
  imports: [CustomersModule, WhatsAppModule],
  controllers: [CampaignsController],
  providers: [CampaignsService, CampaignsScheduler],
  exports: [CampaignsService],
})
export class CampaignsModule {}
