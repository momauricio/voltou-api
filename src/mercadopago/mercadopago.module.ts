import { Module, forwardRef } from '@nestjs/common';
import { MercadoPagoClient } from './mercadopago.client';
import { MercadoPagoController } from './mercadopago.controller';
import { MercadoPagoService } from './mercadopago.service';
import { CheckoutModule } from '../checkout/checkout.module';

@Module({
  imports: [forwardRef(() => CheckoutModule)],
  controllers: [MercadoPagoController],
  providers: [MercadoPagoClient, MercadoPagoService],
  exports: [MercadoPagoService],
})
export class MercadoPagoModule {}
