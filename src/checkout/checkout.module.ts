import { Module, forwardRef } from '@nestjs/common';
import { CheckoutController } from './checkout.controller';
import { OffersController } from './offers.controller';
import { CheckoutService } from './checkout.service';
import { MercadoPagoModule } from '../mercadopago/mercadopago.module';
import { MercadoPagoService } from '../mercadopago/mercadopago.service';
import { PAYMENT_PROVIDER } from './payment-provider';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [forwardRef(() => MercadoPagoModule), EmailModule],
  controllers: [CheckoutController, OffersController],
  providers: [
    CheckoutService,
    {
      provide: PAYMENT_PROVIDER,
      useExisting: MercadoPagoService,
    },
  ],
  exports: [CheckoutService],
})
export class CheckoutModule {}
