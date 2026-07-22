import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
} from '@nestjs/common';
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
