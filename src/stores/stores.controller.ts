import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Patch,
  Put,
  Query,
} from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { z } from 'zod';
import { StoresService } from './stores.service';

const rulesSchema = z.object({
  tenantId: z.string().uuid(),
  storeId: z.string().uuid(),
  rules: z.object({
    sobreNegocio: z.string().max(4000).optional(),
    personalidade: z.string().max(4000).optional(),
    instrucoesExtras: z.string().max(4000).optional(),
    horaInicio: z.string().max(5).optional(),
    horaFim: z.string().max(5).optional(),
    diasAtivos: z.array(z.string().max(10)).max(7).optional(),
    followUpDias: z.string().max(4).optional(),
    descontoPadrao: z.string().max(5).optional(),
    margemMaxima: z.string().max(5).optional(),
    maxDescontoUmProduto: z.string().max(5).optional(),
    maxDescontoDoisOuMais: z.string().max(5).optional(),
    aniversario: z.boolean().optional(),
    cupons: z
      .array(
        z.object({
          id: z.string().max(64),
          codigo: z.string().max(40),
          desconto: z.string().max(20),
          validade: z.string().max(40),
        }),
      )
      .max(50)
      .optional(),
  }),
});

const tenantStoreQuery = z.object({
  tenantId: z.string().uuid(),
  storeId: z.string().uuid(),
});

const hexColor = z
  .string()
  .trim()
  .regex(/^#([0-9A-Fa-f]{6})$/, 'Use cor hex (#RRGGBB).')
  .nullable()
  .optional();

const updateFulfillmentSchema = z.object({
  tenantId: z.string().uuid(),
  storeId: z.string().uuid(),
  deliveryEnabled: z.boolean().optional(),
  shippingCents: z.number().int().nonnegative().max(1_000_000).optional(),
  pickupAddressText: z
    .union([z.string(), z.null()])
    .optional(),
  orderNotifyPhoneE164: z
    .union([z.string(), z.null()])
    .optional(),
});

const updateBrandingSchema = z.object({
  tenantId: z.string().uuid(),
  storeId: z.string().uuid(),
  logoUrl: z
    .union([
      z.string().trim().url().max(2000),
      z
        .string()
        .trim()
        .regex(/^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+$/)
        .max(350_000),
      z.literal(''),
      z.null(),
    ])
    .optional()
    .transform((v) => (v === '' ? null : v)),
  primaryColor: hexColor,
  secondaryColor: hexColor,
  fontFamily: z
    .enum([
      'geist',
      'dm-sans',
      'space-grotesk',
      'nunito',
      'playfair',
      'source-serif',
    ])
    .nullable()
    .optional(),
  message: z
    .union([z.string().trim().max(280), z.literal(''), z.null()])
    .optional()
    .transform((v) => (v === '' ? null : v)),
});

@Controller('stores')
export class StoresController {
  constructor(private readonly storesService: StoresService) {}

  @Public()

  @Get('health')
  health() {
    return this.storesService.health();
  }

  @Get('rules')
  getRules(
    @Query('tenantId') tenantId?: string,
    @Query('storeId') storeId?: string,
  ) {
    const parsed = tenantStoreQuery.safeParse({ tenantId, storeId });
    if (!parsed.success) {
      throw new BadRequestException('tenantId e storeId s�o obrigat�rios.');
    }
    return this.storesService.getRules(parsed.data.tenantId, parsed.data.storeId);
  }

  @Put('rules')
  saveRules(@Body() body: unknown) {
    const parsed = rulesSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten());
    }
    return this.storesService.saveRules(
      parsed.data.tenantId,
      parsed.data.storeId,
      parsed.data.rules,
    );
  }

  @Get('checkout-branding')
  getCheckoutBranding(
    @Query('tenantId') tenantId?: string,
    @Query('storeId') storeId?: string,
  ) {
    const parsed = tenantStoreQuery.safeParse({ tenantId, storeId });
    if (!parsed.success) {
      throw new BadRequestException('tenantId e storeId s�o obrigat�rios.');
    }
    return this.storesService.getCheckoutBranding(
      parsed.data.tenantId,
      parsed.data.storeId,
    );
  }

  @Patch('checkout-branding')
  updateCheckoutBranding(@Body() body: unknown) {
    const parsed = updateBrandingSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten());
    }
    const { tenantId, storeId, ...branding } = parsed.data;
    return this.storesService.updateCheckoutBranding(tenantId, storeId, {
      logoUrl: branding.logoUrl === undefined ? undefined : branding.logoUrl,
      primaryColor:
        branding.primaryColor === undefined ? undefined : branding.primaryColor,
      secondaryColor:
        branding.secondaryColor === undefined
          ? undefined
          : branding.secondaryColor,
      fontFamily:
        branding.fontFamily === undefined ? undefined : branding.fontFamily,
      message: branding.message === undefined ? undefined : branding.message,
    });
  }

  @Get('fulfillment')
  getFulfillment(
    @Query('tenantId') tenantId?: string,
    @Query('storeId') storeId?: string,
  ) {
    const parsed = tenantStoreQuery.safeParse({ tenantId, storeId });
    if (!parsed.success) {
      throw new BadRequestException('tenantId e storeId são obrigatórios.');
    }
    return this.storesService.getFulfillment(
      parsed.data.tenantId,
      parsed.data.storeId,
    );
  }

  @Patch('fulfillment')
  updateFulfillment(@Body() body: unknown) {
    const parsed = updateFulfillmentSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten());
    }
    const { tenantId, storeId, ...fulfillment } = parsed.data;
    return this.storesService.updateFulfillment(tenantId, storeId, fulfillment);
  }
}
