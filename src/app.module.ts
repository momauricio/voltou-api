import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { AccessTokenGuard } from './auth/access-token.guard';
import { TenantsModule } from './tenants/tenants.module';
import { StoresModule } from './stores/stores.module';
import { ProductsModule } from './products/products.module';
import { SalesModule } from './sales/sales.module';
import { WhatsAppModule } from './whatsapp/whatsapp.module';
import { CampaignsModule } from './campaigns/campaigns.module';
import { AgentModule } from './agent/agent.module';
import { PrismaModule } from './prisma/prisma.module';
import { CustomersModule } from './customers/customers.module';
import { CheckoutModule } from './checkout/checkout.module';
import { ImportsModule } from './imports/imports.module';
import { BlingModule } from './bling/bling.module';
import { MercadoPagoModule } from './mercadopago/mercadopago.module';
import { MetricsModule } from './metrics/metrics.module';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    TenantsModule,
    StoresModule,
    ProductsModule,
    SalesModule,
    WhatsAppModule,
    CampaignsModule,
    AgentModule,
    CustomersModule,
    CheckoutModule,
    ImportsModule,
    BlingModule,
    MercadoPagoModule,
    MetricsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: AccessTokenGuard,
    },
  ],
})
export class AppModule {}
