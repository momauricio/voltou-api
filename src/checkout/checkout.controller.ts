import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Query,
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

  @Get('orders')
  listOrders(
    @Query('tenantId') tenantId?: string,
    @Query('storeId') storeId?: string,
    @Query('fulfillmentStatus') fulfillmentStatus?: string,
  ) {
    if (!tenantId || !storeId) {
      throw new BadRequestException('tenantId e storeId obrigatórios.');
    }
    return this.checkoutService.listPaidOrders(
      tenantId,
      storeId,
      fulfillmentStatus,
    );
  }

  @Roles(USER_ROLES.STAFF)
  @Post()
  create(
    @Body() body: unknown,
    @CurrentUser() user?: AccessTokenUser,
  ) {
    const parsed = createCheckoutSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.issues.map((i) => i.message).join(', '),
      );
    }
    if (user == null || user.sub == null || user.sub === '')
      throw new UnauthorizedException('Sessão inválida.');
    return this.checkoutService.create(parsed.data, { staffUserId: user.sub });
  }

  /** HTTP cannot mark paid. Webhook / transparent flow call CheckoutService.markPaid. */
  @Post(':id/mark-paid')
  markPaid(@Param('id') id: string, @Body() body: unknown) {
    throw new ForbiddenException(
      'Pagamento só pode ser confirmado pelo Mercado Pago.',
    );
  }

  @Patch(':id/fulfillment')
  patchFulfillment(
    @Param('id') id: string,
    @Body()
    body: { tenantId?: string; storeId?: string; trackingCode?: unknown } | undefined,
    @CurrentUser() user?: AccessTokenUser,
  ) {
    if (!user || !user.sub) throw new UnauthorizedException('Sessao invalida.');
    const tenantId = body && body.tenantId ? body.tenantId : user.tenantId;
    if (!tenantId) throw new BadRequestException('tenantId obrigatorio.');
    if (
      body &&
      body.trackingCode !== undefined &&
      body.trackingCode !== null &&
      typeof body.trackingCode !== 'string'
    )
      throw new BadRequestException('Invalid tracking code');
    return this.checkoutService.updateFulfillment(id, tenantId, {
      storeId: body && body.storeId,
      trackingCode: body ? body.trackingCode : undefined,
    });
  }
}
