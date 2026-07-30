import { Module } from '@nestjs/common';
import { CampaignsModule } from '../campaigns/campaigns.module';
import { StoresModule } from '../stores/stores.module';
import { InternalApiKeyGuard } from './internal-api-key.guard';
import { InternalController } from './internal.controller';

@Module({
  imports: [StoresModule, CampaignsModule],
  controllers: [InternalController],
  providers: [InternalApiKeyGuard],
})
export class InternalModule {}
