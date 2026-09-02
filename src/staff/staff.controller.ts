import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { Roles } from '../auth/roles.decorator';
import { USER_ROLES } from '../auth/roles';
import {
  CurrentUser,
  type AccessTokenUser,
} from '../auth/current-user.decorator';
import { registerContactSchema, createCheckoutSchema } from '../shared/schemas';
import { StaffService } from './staff.service';
import { CheckoutService } from '../checkout/checkout.service';

@Controller('staff')
@Roles(USER_ROLES.STAFF)
export class StaffController {
  constructor(
    private readonly staffService: StaffService,
    private readonly checkoutService: CheckoutService,
  ) {}

  @Get('stores')
  listStores() {
    return this.staffService.listStores();
  }

  @Get('customers')
  listCustomers() {
    return this.staffService.listCustomers();
  }

  @Post('customers/:id/contact')
  registerContact(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentUser() user?: AccessTokenUser,
  ) {
    if (!user?.sub) {
      throw new UnauthorizedException('Sessão inválida.');
    }
    const parsed = registerContactSchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.issues.map((i) => i.message).join(', '),
      );
    }
    return this.staffService.registerContact(id, {
      staffUserId: user.sub,
      ...parsed.data,
    });
  }

  @Post('checkouts')
  createCheckout(@Body() body: unknown) {
    const parsed = createCheckoutSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.issues.map((i) => i.message).join(', '),
      );
    }
    return this.checkoutService.create(parsed.data);
  }
}
