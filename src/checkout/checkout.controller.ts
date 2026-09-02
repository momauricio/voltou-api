import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
} from '@nestjs/common';
import { CheckoutService } from './checkout.service';
import { createCheckoutSchema } from '../shared/schemas';
import { Public } from '../auth/public.decorator';
import { Roles } from '../auth/roles.decorator';
import { USER_ROLES } from '../auth/roles';

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

  /** Locked: only Mercado Pago webhook may call CheckoutService.markPaid. */
  @Roles(USER_ROLES.STAFF)
  @Post(':id/mark-paid')
  markPaid() {
    throw new ForbiddenException(
      'Pagamento só pode ser confirmado pelo Mercado Pago.',
    );
  }
}
