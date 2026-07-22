import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Inject,
  Post,
  Query,
  forwardRef,
} from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { z } from 'zod';
import { MercadoPagoService } from './mercadopago.service';
import { CheckoutService } from '../checkout/checkout.service';

const tenantStoreQuery = z.object({
  tenantId: z.string().uuid(),
  storeId: z.string().uuid(),
});

const callbackSchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
});

@Controller('mercadopago')
export class MercadoPagoController {
  constructor(
    private readonly mpService: MercadoPagoService,
    @Inject(forwardRef(() => CheckoutService))
    private readonly checkoutService: CheckoutService,
  ) {}

  @Public()
  @Get('health')
  health() {
    return this.mpService.health();
  }

  @Get('authorize-url')
  authorizeUrl(
    @Query('tenantId') tenantId?: string,
    @Query('storeId') storeId?: string,
  ) {
    const parsed = tenantStoreQuery.safeParse({ tenantId, storeId });
    if (!parsed.success) {
      throw new BadRequestException('tenantId e storeId são obrigatórios.');
    }
    return this.mpService.getAuthorizeUrl(
      parsed.data.tenantId,
      parsed.data.storeId,
    );
  }

  @Public()
  @Post('callback')
  callback(@Body() body: unknown) {
    const parsed = callbackSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException('code e state são obrigatórios.');
    }
    return this.mpService.completeOAuth(parsed.data.code, parsed.data.state);
  }

  @Get('connection')
  connection(
    @Query('tenantId') tenantId?: string,
    @Query('storeId') storeId?: string,
  ) {
    const parsed = tenantStoreQuery.safeParse({ tenantId, storeId });
    if (!parsed.success) {
      throw new BadRequestException('tenantId e storeId são obrigatórios.');
    }
    return this.mpService.getConnection(
      parsed.data.tenantId,
      parsed.data.storeId,
    );
  }

  @Delete('connection')
  disconnect(
    @Query('tenantId') tenantId?: string,
    @Query('storeId') storeId?: string,
  ) {
    const parsed = tenantStoreQuery.safeParse({ tenantId, storeId });
    if (!parsed.success) {
      throw new BadRequestException('tenantId e storeId são obrigatórios.');
    }
    return this.mpService.disconnect(
      parsed.data.tenantId,
      parsed.data.storeId,
    );
  }

  /** Always HTTP 200 so Mercado Pago keeps delivering. */
  @Public()
  @Post('webhook')
  @Get('webhook')
  async webhook(
    @Query() query: Record<string, string>,
    @Body() body: unknown,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    try {
      const result = await this.mpService.handleWebhook(query, body, headers);
      if (
        'checkoutId' in result &&
        result.checkoutId &&
        !('ignored' in result && result.ignored)
      ) {
        await this.checkoutService.markPaid(result.checkoutId, undefined, {
          mpPaymentId:
            'paymentId' in result && result.paymentId
              ? String(result.paymentId)
              : undefined,
        });
      }
      return { ok: true, ...result };
    } catch (err) {
      return {
        ok: true,
        ignored: true,
        reason: err instanceof Error ? err.message : 'erro interno',
      };
    }
  }
}
