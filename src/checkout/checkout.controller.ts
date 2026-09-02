import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
} from '@nestjs/common';
import { CheckoutService } from './checkout.service';
import { createCheckoutSchema } from '../shared/schemas';
import { Public } from '../auth/public.decorator';

@Controller('checkouts')
export class CheckoutController {
  constructor(private readonly checkoutService: CheckoutService) {}

  @Public()
  @Get('health')
  health() {
    return this.checkoutService.health();
  }

  @Public()
  @Get('public/:token')
  getPublic(@Param('token') token: string) {
    return this.checkoutService.getByPublicToken(token);
  }

  @Post()
  create(@Body() body: unknown) {
    const parsed = createCheckoutSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.issues.map((i) => i.message).join(', '),
      );
    }
    return this.checkoutService.create(parsed.data);
  }

  @Post(':id/mark-paid')
  markPaid(
    @Param('id') id: string,
    @Body() body: { tenantId?: string },
  ) {
    return this.checkoutService.markPaid(id, body?.tenantId);
  }
}
