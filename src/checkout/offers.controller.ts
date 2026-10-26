import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { PUBLIC_PAY_THROTTLE } from '../security/rate-limits';
import { Public } from '../auth/public.decorator';
import { CheckoutService } from './checkout.service';

@Controller('offers')
export class OffersController {
  constructor(private readonly checkoutService: CheckoutService) {}

  @Public()
  @Get('public/:storeSlug/:coupon')
  getPublic(
    @Param('storeSlug') storeSlug: string,
    @Param('coupon') coupon: string,
  ) {
    if (!storeSlug?.trim() || !coupon?.trim()) {
      throw new BadRequestException('slug e cupom são obrigatórios.');
    }
    return this.checkoutService.getPublicOffer(storeSlug, coupon);
  }

  @Public()
  @Throttle(PUBLIC_PAY_THROTTLE)
  @Post('public/:storeSlug/:coupon/pay')
  pay(
    @Param('storeSlug') storeSlug: string,
    @Param('coupon') coupon: string,
    @Body() body?: { selectedAddonIds?: string[] },
  ) {
    if (!storeSlug?.trim() || !coupon?.trim()) {
      throw new BadRequestException('slug e cupom são obrigatórios.');
    }
    const selectedAddonIds = Array.isArray(body?.selectedAddonIds)
      ? body.selectedAddonIds
      : [];
    return this.checkoutService.payPublicOffer(
      storeSlug,
      coupon,
      selectedAddonIds,
    );
  }

  /** Checkout Transparente (Payment Brick): cartão ou Pix via /v1/payments. */
  @Public()
  @Post('public/:storeSlug/:coupon/payments')
  createPayment(
    @Param('storeSlug') storeSlug: string,
    @Param('coupon') coupon: string,
    @Body()
    body: {
      selectedAddonIds?: string[];
      paymentMethodId?: string;
      token?: string;
      installments?: number;
      issuerId?: string | number;
      payerEmail?: string;
      payerIdentification?: { type: string; number: string };
      fulfillmentMethod?: string;
      shippingAddress?: unknown;
    },
  ) {
    if (!storeSlug?.trim() || !coupon?.trim()) {
      throw new BadRequestException('slug e cupom são obrigatórios.');
    }
    if (!body?.paymentMethodId?.trim()) {
      throw new BadRequestException('paymentMethodId é obrigatório.');
    }
    if (!body?.payerEmail?.trim()) {
      throw new BadRequestException('payerEmail é obrigatório.');
    }
    if (
      body?.fulfillmentMethod !== 'pickup' &&
      body?.fulfillmentMethod !== 'delivery'
    ) {
      throw new BadRequestException(
        'Escolha retirar na loja ou receber em casa.',
      );
    }
    return this.checkoutService.createTransparentPayment(storeSlug, coupon, {
      selectedAddonIds: Array.isArray(body.selectedAddonIds)
        ? body.selectedAddonIds
        : [],
      paymentMethodId: body.paymentMethodId,
      token: body.token,
      installments: body.installments,
      issuerId: body.issuerId != null ? String(body.issuerId) : undefined,
      payerEmail: body.payerEmail,
      payerIdentification: body.payerIdentification,
      fulfillmentMethod: body.fulfillmentMethod,
      shippingAddress: body.shippingAddress,
    });
  }

  @Public()
  @Get('public/:storeSlug/:coupon/status')
  status(
    @Param('storeSlug') storeSlug: string,
    @Param('coupon') coupon: string,
  ) {
    if (!storeSlug?.trim() || !coupon?.trim()) {
      throw new BadRequestException('slug e cupom são obrigatórios.');
    }
    return this.checkoutService.getPublicOfferStatus(storeSlug, coupon);
  }
}
