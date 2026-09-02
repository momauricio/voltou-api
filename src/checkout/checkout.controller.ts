import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { CheckoutService } from './checkout.service';
import { createCheckoutSchema } from '../shared/schemas';
import { Public } from '../auth/public.decorator';
import { Roles } from '../auth/roles.decorator';
import { USER_ROLES } from '../auth/roles';
import {
  CurrentUser,
  type AccessTokenUser,
} from '../auth/current-user.decorator';

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

  @Roles(USER_ROLES.STAFF)
  @Post()
  create(
    @Body() body: unknown,
    @CurrentUser() user?: AccessTokenUser,
  ) {
    if (!user?.sub) {
      throw new UnauthorizedException('Sessão inválida.');
    }
    const parsed = createCheckoutSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.issues.map((i) => i.message).join(', '),
      );
    }
    return this.checkoutService.create(parsed.data, {
      staffUserId: user.sub,
    });
  }

  /** Staff-gated 403: HTTP cannot mark paid. Webhook calls CheckoutService.markPaid. */
  @Roles(USER_ROLES.STAFF)
  @Post(':id/mark-paid')
  markPaid() {
    throw new ForbiddenException(
      'Pagamento só pode ser confirmado pelo Mercado Pago.',
    );
  }
}
