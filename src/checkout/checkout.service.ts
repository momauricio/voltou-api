import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  Inject,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCheckoutInput } from '../shared/schemas';
import { randomBytes, randomUUID } from 'crypto';
import {
  PAYMENT_PROVIDER,
  type PaymentProvider,
} from './payment-provider';
import { EmailService } from '../email/email.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { MercadoPagoService } from '../mercadopago/mercadopago.service';
import {
  STORE_RULES_TITLE,
  type StoreRules,
} from '../stores/stores.service';
import {
  type CheckoutAddon,
  type PaidLine,
  parseAddonsJson,
  parsePaidLinesJson,
  serializeAddons,
  serializePaidLines,
} from './checkout-addons';
import {
  clampDiscountBps,
  effectiveLineAmountCents,
  getDiscountCapsFromRules,
} from './discount-caps';
import {
  buildPaidLines,
  UnknownCheckoutAddonError,
} from './build-paid-lines';
import {
  expectedPaidLines,
  findMissingPaidLines,
} from './mark-paid-sales';
import {
  computePaymentAmounts,
  parseShippingAddress,
  resolveShippingCents,
  serializeShippingAddress,
  type ShippingAddress,
} from './fulfillment';
import {
  assertTrackingAllowed,
  normalizeTrackingCode,
} from './checkout-tracking';

@Injectable()
export class CheckoutService {
  private readonly logger = new Logger(CheckoutService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly whatsapp: WhatsAppService,
    @Optional()
    @Inject(PAYMENT_PROVIDER)
    private readonly paymentProvider?: PaymentProvider,
    @Optional()
    private readonly mercadoPago?: MercadoPagoService,
  ) {}

  health() {
    return {
      module: 'checkout',
      status: 'ok',
      provider: this.paymentProvider?.id ?? 'stub',
    };
  }

  async create(input: CreateCheckoutInput, actor: { staffUserId: string }) {
    if (actor == null || actor.staffUserId == null || actor.staffUserId === '')
      throw new UnauthorizedException('Sessão inválida.');
    const customer = await this.prisma.customer.findFirst({
      where: {
        id: input.customerId,
        tenantId: input.tenantId,
        storeId: input.storeId,
      },
    });
    if (!customer) throw new NotFoundException('Cliente não encontrado.');

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: input.tenantId },
    });
    if (!tenant) throw new NotFoundException('Loja (tenant) não encontrada.');

    const store = await this.prisma.store.findFirst({
      where: { id: input.storeId, tenantId: input.tenantId },
    });
    if (!store) throw new NotFoundException('Loja não encontrada.');

    if (!store.slug?.trim()) {
      throw new BadRequestException(
        'A loja precisa de um slug para gerar o link /loja/…',
      );
    }

    const preferred = store.preferredCheckoutProvider || 'mercadopago';
    const canUseMp =
      this.paymentProvider?.id === 'mercadopago' &&
      preferred === 'mercadopago' &&
      (await this.paymentProvider.isConnected(input.tenantId, input.storeId));

    if (!canUseMp || !this.paymentProvider) {
      throw new BadRequestException(
        'Conecte o Mercado Pago em Perfil antes de gerar o link de pagamento.',
      );
    }

    let productName = input.productName;
    let listPriceCents = input.amountCents;
    let productId = input.productId;

    if (input.interestId) {
      const interest = await this.prisma.customerInterest.findFirst({
        where: {
          id: input.interestId,
          tenantId: input.tenantId,
          customerId: input.customerId,
        },
      });
      if (!interest) throw new BadRequestException('Interesse não encontrado.');
      productName = productName ?? interest.productNameSnapshot;
      listPriceCents =
        listPriceCents ?? interest.productPriceCents ?? undefined;
      productId = productId ?? interest.productId ?? undefined;
    }

    if (!productId) {
      throw new BadRequestException(
        'Selecione um produto para gerar o checkout rastreado.',
      );
    }

    const product = await this.prisma.product.findFirst({
      where: {
        id: productId,
        tenantId: input.tenantId,
        storeId: input.storeId,
      },
    });
    if (!product) throw new BadRequestException('Produto não encontrado.');
    productName = productName ?? product.name;
    listPriceCents = listPriceCents ?? product.priceCents;

    if (!productName || !listPriceCents || listPriceCents <= 0) {
      throw new BadRequestException(
        'Informe produto e valor para gerar o checkout.',
      );
    }

    const rules = await this.loadStoreRules(input.tenantId, input.storeId);
    const caps = getDiscountCapsFromRules(rules);
    const requestedOrDefaultBps =
      input.discountBps ?? this.descontoPadraoToBps(rules);
    const discountBps = clampDiscountBps(
      requestedOrDefaultBps,
      caps.oneProductBps,
    );
    const amountCents = effectiveLineAmountCents(listPriceCents, discountBps);

    const addonInputs = input.addons ?? [];
    const addons: CheckoutAddon[] = [];
    for (const addonInput of addonInputs) {
      const addonProduct = await this.prisma.product.findFirst({
        where: {
          id: addonInput.productId,
          tenantId: input.tenantId,
          storeId: input.storeId,
        },
      });
      if (!addonProduct) {
        throw new BadRequestException(
          `Produto adicional não encontrado: ${addonInput.productId}`,
        );
      }
      if (addonProduct.priceCents <= 0) {
        throw new BadRequestException(
          `Produto adicional sem preço válido: ${addonProduct.name}`,
        );
      }
      addons.push({
        id: randomUUID(),
        productId: addonProduct.id,
        productNameSnapshot: addonProduct.name,
        listPriceCents: addonProduct.priceCents,
        discountBps: clampDiscountBps(
          addonInput.discountBps,
          caps.twoOrMoreBps,
        ),
        selectedByDefault: addonInput.selectedByDefault ?? false,
      });
    }

    const commissionRateBps = tenant.commissionRateBps;
    const commissionCents = Math.round(
      (amountCents * commissionRateBps) / 10000,
    );
    const token = randomBytes(16).toString('hex');
    const couponCode = await this.generateCouponCode(
      input.storeId,
      customer.displayName,
      discountBps,
    );
    const webUrl = process.env.WEB_URL ?? 'http://localhost:3000';
    const paymentUrl = `${webUrl}/loja/${store.slug}/${couponCode}`;
    const expiresAt = new Date(
      Date.now() + input.expiresInHours * 60 * 60 * 1000,
    );

    const checkout = await this.prisma.checkout.create({
      data: {
        tenantId: input.tenantId,
        storeId: input.storeId,
        customerId: input.customerId,
        productId,
        productNameSnapshot: productName,
        amountCents,
        listPriceCents,
        discountBps,
        couponCode,
        commissionRateBps,
        commissionCents,
        interestId: input.interestId,
        createdBy: input.createdBy,
        staffUserId: actor.staffUserId,
        provider: 'stub',
        externalId: token,
        paymentUrl,
        expiresAt,
        status: 'pending',
        addonsJson: serializeAddons(addons),
      },
    });

    try {
      const link = await this.paymentProvider.createPaymentLink({
        tenantId: input.tenantId,
        storeId: input.storeId,
        checkoutId: checkout.id,
        publicToken: token,
        storeSlug: store.slug,
        couponCode,
        amountCents,
        title: productName,
        commissionCents,
      });

      await this.prisma.checkout.update({
        where: { id: checkout.id },
        data: {
          provider: 'mercadopago',
          providerRef: link.providerRef,
          providerInitPoint: link.initPoint,
        },
      });
    } catch (err) {
      await this.prisma.checkout.delete({ where: { id: checkout.id } });
      this.logger.warn(
        `Falha ao criar Preference MP: ${err instanceof Error ? err.message : err}`,
      );
      throw new BadRequestException(
        'Não foi possível criar o pagamento no Mercado Pago. Tente novamente.',
      );
    }

    await this.prisma.customerEvent.create({
      data: {
        tenantId: input.tenantId,
        storeId: input.storeId,
        customerId: input.customerId,
        type: 'checkout_sent',
        title: `Link de pagamento: ${productName}`,
        detail: `R$ ${(amountCents / 100).toFixed(2)} · cupom ${couponCode} · comissão Voltou ${(commissionRateBps / 100).toFixed(1)}%`,
        metadata: JSON.stringify({
          checkoutId: checkout.id,
          paymentUrl,
          couponCode,
          provider: 'mercadopago',
        }),
      },
    });

    return this.prisma.checkout.findUniqueOrThrow({
      where: { id: checkout.id },
    });
  }

  async getByPublicToken(token: string) {
    const checkout = await this.prisma.checkout.findFirst({
      where: { externalId: token },
      include: {
        customer: true,
        store: true,
        tenant: true,
      },
    });
    if (!checkout) throw new NotFoundException('Checkout não encontrado.');

    const expired =
      checkout.expiresAt != null && checkout.expiresAt.getTime() < Date.now();

    return {
      id: checkout.id,
      status:
        expired && checkout.status === 'pending' ? 'expired' : checkout.status,
      productName: checkout.productNameSnapshot,
      amountCents: checkout.amountCents,
      listPriceCents: checkout.listPriceCents,
      discountBps: checkout.discountBps,
      couponCode: checkout.couponCode,
      storeSlug: checkout.store.slug,
      currency: checkout.currency,
      storeName: checkout.store.name,
      customerName: checkout.customer.displayName,
      expiresAt: checkout.expiresAt,
      paidAt: checkout.paidAt,
      provider: checkout.provider,
      initPoint: checkout.providerInitPoint,
      branding: {
        logoUrl: checkout.store.checkoutLogoUrl,
        primaryColor: checkout.store.checkoutPrimaryColor,
        secondaryColor: checkout.store.checkoutSecondaryColor,
        fontFamily: checkout.store.checkoutFontFamily ?? 'geist',
        message: checkout.store.checkoutMessage,
      },
    };
  }

  async getPublicOffer(storeSlug: string, coupon: string) {
    const checkout = await this.findByStoreSlugAndCoupon(storeSlug, coupon);
    await this.recordClick(checkout.id);

    const fresh = await this.prisma.checkout.findUniqueOrThrow({
      where: { id: checkout.id },
      include: { customer: true, store: true, product: true },
    });

    const expired =
      fresh.expiresAt != null && fresh.expiresAt.getTime() < Date.now();
    const status =
      expired && fresh.status === 'pending' ? 'expired' : fresh.status;
    // Always expose principal pricing (not cart total) so /loja re-entry
    // can do liveTotal = principal + selected addon amounts without double-count.
    const listPrice = fresh.listPriceCents ?? fresh.amountCents;
    const principalAmountCents =
      fresh.listPriceCents != null
        ? effectiveLineAmountCents(fresh.listPriceCents, fresh.discountBps)
        : fresh.amountCents;
    const savingsCents = Math.max(0, listPrice - principalAmountCents);

    const rules = await this.loadStoreRules(fresh.tenantId, fresh.storeId);
    const discountCaps = getDiscountCapsFromRules(rules);
    const addons = parseAddonsJson(fresh.addonsJson).map((addon) => ({
      id: addon.id,
      productName: addon.productNameSnapshot,
      listPriceCents: addon.listPriceCents,
      amountCents: effectiveLineAmountCents(
        addon.listPriceCents,
        addon.discountBps,
      ),
      discountBps: addon.discountBps,
      selectedByDefault: addon.selectedByDefault,
    }));

    const mpConnected = this.paymentProvider
      ? await this.paymentProvider.isConnected(fresh.tenantId, fresh.storeId)
      : false;
    const mpPublicKey =
      mpConnected && this.mercadoPago
        ? await this.mercadoPago.getSellerPublicKey(
            fresh.tenantId,
            fresh.storeId,
          )
        : null;

    return {
      id: fresh.id,
      status,
      productName: fresh.productNameSnapshot,
      productImageUrl: null as string | null,
      amountCents: principalAmountCents,
      listPriceCents: listPrice,
      discountBps: fresh.discountBps,
      savingsCents,
      couponCode: fresh.couponCode,
      currency: fresh.currency,
      storeName: fresh.store.name,
      storeSlug: fresh.store.slug,
      customerName: fresh.customer.displayName,
      customerFirstName: firstName(fresh.customer.displayName),
      expiresAt: fresh.expiresAt,
      paidAt: fresh.paidAt,
      paymentMode: 'transparent' as const,
      mpPublicKey,
      canPay: status === 'pending' && mpConnected && Boolean(mpPublicKey),
      addons,
      discountCaps,
      branding: {
        logoUrl: fresh.store.checkoutLogoUrl,
        primaryColor: fresh.store.checkoutPrimaryColor,
        secondaryColor: fresh.store.checkoutSecondaryColor,
        fontFamily: fresh.store.checkoutFontFamily ?? 'geist',
        message: fresh.store.checkoutMessage,
      },
      deliveryEnabled: fresh.store.deliveryEnabled,
      shippingCents: fresh.store.shippingCents,
      pickupAddressText: fresh.store.pickupAddressText,
    };
  }

  /**
   * Checkout transparente: cria pagamento na conta do lojista com application_fee.
   */
  async createTransparentPayment(
    storeSlug: string,
    coupon: string,
    input: {
      selectedAddonIds?: string[];
      paymentMethodId: string;
      token?: string;
      installments?: number;
      issuerId?: string;
      payerEmail: string;
      payerIdentification?: { type: string; number: string };
      fulfillmentMethod: 'pickup' | 'delivery';
      shippingAddress?: unknown;
    },
  ) {
    if (!this.mercadoPago) {
      throw new BadRequestException(
        'Pagamento indisponível. A loja precisa conectar o Mercado Pago.',
      );
    }

    const checkout = await this.findByStoreSlugAndCoupon(storeSlug, coupon);
    const expired =
      checkout.expiresAt != null && checkout.expiresAt.getTime() < Date.now();
    if (expired && checkout.status === 'pending') {
      throw new BadRequestException('Este link de pagamento expirou.');
    }
    if (checkout.status === 'paid') {
      throw new BadRequestException('Este pagamento já foi confirmado.');
    }
    if (checkout.status !== 'pending') {
      throw new BadRequestException('Checkout indisponível.');
    }
    if (!checkout.productId) {
      throw new BadRequestException('Checkout sem produto principal.');
    }

    const connected = await this.mercadoPago.isConnected(
      checkout.tenantId,
      checkout.storeId,
    );
    if (!connected) {
      throw new BadRequestException(
        'Pagamento indisponível. A loja precisa conectar o Mercado Pago.',
      );
    }

    const selectedAddonIds = Array.isArray(input.selectedAddonIds)
      ? input.selectedAddonIds
      : [];
    const addons = parseAddonsJson(checkout.addonsJson);
    const rules = await this.loadStoreRules(checkout.tenantId, checkout.storeId);
    const caps = getDiscountCapsFromRules(rules);
    const listPriceCents = checkout.listPriceCents ?? checkout.amountCents;

    let lines: PaidLine[];
    let total: number;
    try {
      ({ lines, total } = buildPaidLines({
        productId: checkout.productId,
        productNameSnapshot: checkout.productNameSnapshot,
        listPriceCents,
        discountBps: checkout.discountBps,
        addons,
        selectedAddonIds,
        caps,
        commissionRateBps: checkout.commissionRateBps,
      }));
    } catch (e) {
      if (e instanceof UnknownCheckoutAddonError) {
        throw new BadRequestException(e.message);
      }
      throw e;
    }

    const method = input.fulfillmentMethod;
    if (method !== 'pickup' && method !== 'delivery') {
      throw new BadRequestException(
        'Escolha retirar na loja ou receber em casa.',
      );
    }
    const store = await this.prisma.store.findUniqueOrThrow({
      where: { id: checkout.storeId },
    });
    if (method === 'delivery' && !store.deliveryEnabled) {
      throw new BadRequestException(
        'Esta loja não oferece entrega no momento.',
      );
    }
    const shippingCents = resolveShippingCents(method, store.shippingCents);
    let shippingAddressJson: string | null = null;
    if (method === 'delivery') {
      try {
        shippingAddressJson = serializeShippingAddress(
          parseShippingAddress(input.shippingAddress),
        );
      } catch (e) {
        throw new BadRequestException(
          e instanceof Error ? e.message : 'Endereço inválido.',
        );
      }
    }
    const { chargeCents, commissionCents: feeCents } = computePaymentAmounts(
      total,
      shippingCents,
      checkout.commissionRateBps,
    );

    const payerEmail = input.payerEmail?.trim() || '';
    if (!payerEmail || !payerEmail.includes('@')) {
      throw new BadRequestException('Informe um e-mail válido para o pagamento.');
    }

    const paymentMethodId = input.paymentMethodId?.trim().toLowerCase();
    if (!paymentMethodId) {
      throw new BadRequestException('Método de pagamento obrigatório.');
    }

    // Cartão exige token; Pix (bank_transfer) não.
    const isPix = paymentMethodId === 'pix';
    if (!isPix && !input.token?.trim()) {
      throw new BadRequestException('Token do cartão obrigatório.');
    }

    await this.prisma.checkout.update({
      where: { id: checkout.id },
      data: {
        commissionCents: feeCents,
        paidLinesJson: serializePaidLines(lines),
        provider: 'mercadopago',
        fulfillmentMethod: method,
        shippingCents,
        shippingAddressJson,
      },
    });

    let payment;
    try {
      payment = await this.mercadoPago.createTransparentPayment({
        tenantId: checkout.tenantId,
        storeId: checkout.storeId,
        checkoutId: checkout.id,
        amountCents: chargeCents,
        commissionCents: feeCents,
        description: lines.map((l) => l.productNameSnapshot).join(' + '),
        paymentMethodId,
        token: input.token,
        installments: input.installments,
        issuerId: input.issuerId,
        payerEmail,
        payerIdentification: input.payerIdentification,
        idempotencyKey: randomUUID(),
      });
    } catch (err) {
      throw new BadRequestException(
        err instanceof Error
          ? err.message
          : 'Não foi possível processar o pagamento.',
      );
    }

    await this.prisma.checkout.update({
      where: { id: checkout.id },
      data: {
        providerRef: String(payment.id),
        mpPaymentId: String(payment.id),
      },
    });

    if (payment.status === 'approved') {
      await this.markPaid(checkout.id, checkout.tenantId, {
        mpPaymentId: String(payment.id),
      });
    }

    return {
      paymentId: payment.id,
      status: payment.status,
      statusDetail: payment.status_detail ?? null,
      amountCents: chargeCents,
      pixQrCode:
        payment.point_of_interaction?.transaction_data?.qr_code ?? null,
      pixQrCodeBase64:
        payment.point_of_interaction?.transaction_data?.qr_code_base64 ?? null,
      pixTicketUrl:
        payment.point_of_interaction?.transaction_data?.ticket_url ?? null,
    };
  }

  async payPublicOffer(
    storeSlug: string,
    coupon: string,
    selectedAddonIds: string[] = [],
  ) {
    const checkout = await this.findByStoreSlugAndCoupon(storeSlug, coupon);
    const expired =
      checkout.expiresAt != null && checkout.expiresAt.getTime() < Date.now();
    if (expired && checkout.status === 'pending') {
      throw new BadRequestException('Este link de pagamento expirou.');
    }
    if (checkout.status === 'paid') {
      throw new BadRequestException('Este pagamento já foi confirmado.');
    }
    if (checkout.status !== 'pending') {
      throw new BadRequestException('Checkout indisponível.');
    }
    if (!checkout.productId) {
      throw new BadRequestException('Checkout sem produto principal.');
    }

    if (!this.paymentProvider) {
      throw new BadRequestException(
        'Pagamento indisponível. A loja precisa conectar o Mercado Pago.',
      );
    }

    const connected = await this.paymentProvider.isConnected(
      checkout.tenantId,
      checkout.storeId,
    );
    if (!connected) {
      throw new BadRequestException(
        'Pagamento indisponível. A loja precisa conectar o Mercado Pago.',
      );
    }

    const addons = parseAddonsJson(checkout.addonsJson);
    const rules = await this.loadStoreRules(checkout.tenantId, checkout.storeId);
    const caps = getDiscountCapsFromRules(rules);
    const listPriceCents = checkout.listPriceCents ?? checkout.amountCents;

    let lines: PaidLine[];
    let total: number;
    let commissionCents: number;
    try {
      ({ lines, total, commissionCents } = buildPaidLines({
        productId: checkout.productId,
        productNameSnapshot: checkout.productNameSnapshot,
        listPriceCents,
        discountBps: checkout.discountBps,
        addons,
        selectedAddonIds,
        caps,
        commissionRateBps: checkout.commissionRateBps,
      }));
    } catch (e) {
      if (e instanceof UnknownCheckoutAddonError) {
        throw new BadRequestException(e.message);
      }
      throw e;
    }

    const items = lines.map((line) => ({
      id:
        line.kind === 'addon' && line.addonId
          ? line.addonId
          : line.productId,
      title: line.productNameSnapshot,
      amountCents: line.amountCents,
    }));

    const link = await this.paymentProvider.createPaymentLink({
      tenantId: checkout.tenantId,
      storeId: checkout.storeId,
      checkoutId: checkout.id,
      publicToken: checkout.externalId ?? checkout.id,
      storeSlug: checkout.store.slug,
      couponCode: checkout.couponCode ?? undefined,
      amountCents: total,
      title: checkout.productNameSnapshot,
      commissionCents,
      items,
    });

    // Keep principal amountCents / listPriceCents / discountBps unchanged so
    // revisiting /loja while pending does not treat cart total as principal.
    // Cart snapshot lives in paidLinesJson; amountCents is finalized on markPaid.
    await this.prisma.checkout.update({
      where: { id: checkout.id },
      data: {
        commissionCents,
        paidLinesJson: serializePaidLines(lines),
        provider: 'mercadopago',
        providerRef: link.providerRef,
        providerInitPoint: link.initPoint,
      },
    });

    return { checkout_url: link.initPoint };
  }

  async getPublicOfferStatus(storeSlug: string, coupon: string) {
    const checkout = await this.findByStoreSlugAndCoupon(storeSlug, coupon);
    const expired =
      checkout.expiresAt != null && checkout.expiresAt.getTime() < Date.now();
    const paidLines = parsePaidLinesJson(checkout.paidLinesJson);
    const amountCents =
      paidLines.length > 0
        ? paidLines.reduce((sum, line) => sum + line.amountCents, 0)
        : checkout.amountCents;
    return {
      status:
        expired && checkout.status === 'pending' ? 'expired' : checkout.status,
      paidAt: checkout.paidAt,
      amountCents,
      productName: checkout.productNameSnapshot,
      storeName: checkout.store.name,
      storeSlug: checkout.store.slug,
      couponCode: checkout.couponCode,
      customerName: checkout.customer.displayName,
      listPriceCents: checkout.listPriceCents ?? checkout.amountCents,
      discountBps: checkout.discountBps,
      currency: checkout.currency,
      paidLines,
      branding: {
        logoUrl: checkout.store.checkoutLogoUrl,
        primaryColor: checkout.store.checkoutPrimaryColor,
        secondaryColor: checkout.store.checkoutSecondaryColor,
        fontFamily: checkout.store.checkoutFontFamily ?? 'geist',
        message: checkout.store.checkoutMessage,
      },
    };
  }

  /** Marks checkout paid (webhook MP / simulate pay). */
  async markPaid(
    checkoutId: string,
    tenantId?: string,
    opts?: { mpPaymentId?: string },
  ) {
    const paidAt = new Date();

    const result = await this.prisma.$transaction(async (tx) => {
      const checkout = await tx.checkout.findFirst({
        where: {
          id: checkoutId,
          ...(tenantId ? { tenantId } : {}),
        },
      });
      if (!checkout) throw new NotFoundException('Checkout não encontrado.');
      if (checkout.status !== 'pending' && checkout.status !== 'paid') {
        throw new BadRequestException('Checkout não está pendente.');
      }

      const expected = expectedPaidLines(checkout);
      const existingSales = await tx.sale.findMany({
        where: { checkoutId: checkout.id },
        select: { productId: true, amountCents: true },
      });
      const missing = findMissingPaidLines(expected, existingSales);
      const salesComplete = missing.length === 0;

      if (checkout.status === 'paid' && salesComplete) {
        if (opts?.mpPaymentId && !checkout.mpPaymentId) {
          const updated = await tx.checkout.update({
            where: { id: checkout.id },
            data: { mpPaymentId: opts.mpPaymentId },
          });
          return {
            checkout: updated,
            alreadyComplete: true as const,
            didTransitionToPaid: false as const,
          };
        }
        return {
          checkout,
          alreadyComplete: true as const,
          didTransitionToPaid: false as const,
        };
      }

      for (const line of missing) {
        const lineCommission = Math.round(
          (line.amountCents * checkout.commissionRateBps) / 10000,
        );
        await tx.sale.create({
          data: {
            tenantId: checkout.tenantId,
            storeId: checkout.storeId,
            customerId: checkout.customerId,
            productId: line.productId,
            amountCents: line.amountCents,
            source: checkout.createdBy === 'ai' ? 'ai' : 'checkout_link',
            status: 'completed',
            checkoutId: checkout.id,
            commissionCents: lineCommission,
            commissionRateBps: checkout.commissionRateBps,
            mpPaymentId: opts?.mpPaymentId ?? null,
            soldAt: checkout.paidAt ?? paidAt,
          },
        });
      }

      if (checkout.status === 'pending') {
        const paidTotalCents = expected.reduce(
          (sum, line) => sum + line.amountCents,
          0,
        );
        const updated = await tx.checkout.update({
          where: { id: checkout.id },
          data: {
            status: 'paid',
            paidAt,
            amountCents:
              (paidTotalCents > 0 ? paidTotalCents : checkout.amountCents) +
              (checkout.shippingCents ?? 0),
            fulfillmentStatus: checkout.fulfillmentStatus ?? 'awaiting',
            ...(opts?.mpPaymentId ? { mpPaymentId: opts.mpPaymentId } : {}),
          },
        });
        return {
          checkout: updated,
          alreadyComplete: false as const,
          didTransitionToPaid: true as const,
        };
      }

      // paid but sales were incomplete — repair only
      if (opts?.mpPaymentId && !checkout.mpPaymentId) {
        const updated = await tx.checkout.update({
          where: { id: checkout.id },
          data: { mpPaymentId: opts.mpPaymentId },
        });
        return {
          checkout: updated,
          alreadyComplete: false as const,
          didTransitionToPaid: false as const,
        };
      }
      return {
        checkout,
        alreadyComplete: false as const,
        didTransitionToPaid: false as const,
      };
    });

    if (result.alreadyComplete) {
      return result.checkout;
    }

    // Side effects only after a successful pending→paid transition (once).
    if (result.didTransitionToPaid) {
      if (result.checkout.interestId) {
        await this.prisma.customerInterest.updateMany({
          where: { id: result.checkout.interestId },
          data: { status: 'converted' },
        });
      }

      const existingEvent = await this.prisma.customerEvent.findFirst({
        where: {
          tenantId: result.checkout.tenantId,
          customerId: result.checkout.customerId,
          type: 'checkout_paid',
          metadata: {
            contains: result.checkout.id,
          },
        },
        select: { id: true },
      });
      if (!existingEvent) {
        await this.prisma.customerEvent.create({
          data: {
            tenantId: result.checkout.tenantId,
            storeId: result.checkout.storeId,
            customerId: result.checkout.customerId,
            type: 'checkout_paid',
            title: `Pagamento confirmado: ${result.checkout.productNameSnapshot}`,
            detail: `R$ ${(result.checkout.amountCents / 100).toFixed(2)} · Voltou R$ ${(result.checkout.commissionCents / 100).toFixed(2)}`,
            metadata: JSON.stringify({
              checkoutId: result.checkout.id,
              mpPaymentId: opts?.mpPaymentId,
              couponCode: result.checkout.couponCode,
            }),
            occurredAt: result.checkout.paidAt ?? paidAt,
          },
        });
      }

      void this.notifyMerchantPaid(result.checkout.id).catch((err) => {
        this.logger.warn(
          `Falha ao notificar lojista do pagamento: ${err instanceof Error ? err.message : err}`,
        );
      });

      void this.notifyMerchantOrderWhatsApp(result.checkout.id).catch((err) => {
        this.logger.warn(
          `Falha ao enviar WhatsApp de pedido: ${err instanceof Error ? err.message : err}`,
        );
      });
    }

    return result.checkout;
  }

  private async findByStoreSlugAndCoupon(storeSlug: string, coupon: string) {
    const code = coupon.trim().toUpperCase();
    const store = await this.prisma.store.findFirst({
      where: { slug: storeSlug.trim().toLowerCase() },
    });
    if (!store) {
      // also try exact slug match (slugs may be mixed case)
      const storeExact = await this.prisma.store.findFirst({
        where: { slug: storeSlug.trim() },
      });
      if (!storeExact) throw new NotFoundException('Oferta não encontrada.');
      const checkout = await this.prisma.checkout.findFirst({
        where: { storeId: storeExact.id, couponCode: code },
        include: { customer: true, store: true, product: true },
      });
      if (!checkout) throw new NotFoundException('Oferta não encontrada.');
      return checkout;
    }

    const checkout = await this.prisma.checkout.findFirst({
      where: { storeId: store.id, couponCode: code },
      include: { customer: true, store: true, product: true },
    });
    if (!checkout) throw new NotFoundException('Oferta não encontrada.');
    return checkout;
  }

  private async recordClick(checkoutId: string) {
    const existing = await this.prisma.checkout.findUnique({
      where: { id: checkoutId },
      select: { clickedAt: true },
    });
    await this.prisma.checkout.update({
      where: { id: checkoutId },
      data: {
        clickCount: { increment: 1 },
        ...(existing?.clickedAt
          ? {}
          : { clickedAt: new Date() }),
      },
    });
  }

  private async loadStoreRules(
    tenantId: string,
    storeId: string,
  ): Promise<StoreRules | null> {
    const row = await this.prisma.storeKnowledge.findFirst({
      where: { tenantId, storeId, title: STORE_RULES_TITLE },
    });
    if (!row) return null;
    try {
      return JSON.parse(row.content) as StoreRules;
    } catch {
      return null;
    }
  }

  private descontoPadraoToBps(rules: StoreRules | null): number {
    if (!rules) return 1000;
    const raw = (rules.descontoPadrao ?? '10').replace(/[^\d.]/g, '');
    const pct = Number(raw);
    if (!Number.isFinite(pct) || pct <= 0) return 1000;
    return Math.min(9000, Math.round(pct * 100));
  }

  private async generateCouponCode(
    storeId: string,
    displayName: string,
    discountBps: number,
  ) {
    const namePart = firstName(displayName)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z]/g, '')
      .toUpperCase()
      .slice(0, 12);
    const discountPct = Math.round(discountBps / 100);
    const base = `${namePart || 'OFERTA'}${discountPct || 10}`;

    for (let i = 0; i < 12; i++) {
      // Always append entropy so offer URLs are not guessable from first name + discount.
      const suffix = randomBytes(3).toString('hex').toUpperCase().slice(0, 4);
      const code = `${base}${suffix}`.slice(0, 24);
      const clash = await this.prisma.checkout.findFirst({
        where: { storeId, couponCode: code },
        select: { id: true },
      });
      if (!clash) return code;
    }

    return `${base}${randomBytes(4).toString('hex').toUpperCase()}`.slice(
      0,
      24,
    );
  }

  /** E-mail para o dono da loja avisando que um link foi pago. */
  private async notifyMerchantPaid(checkoutId: string) {
    const checkout = await this.prisma.checkout.findUnique({
      where: { id: checkoutId },
      include: { customer: true, store: true },
    });
    if (!checkout) return;

    const owner = await this.prisma.user.findFirst({
      where: { tenantId: checkout.tenantId },
      orderBy: { createdAt: 'asc' },
    });
    if (!owner) return;

    await this.email.sendPaymentReceived({
      to: owner.email,
      storeName: checkout.store.name,
      customerName: checkout.customer.displayName,
      productName: checkout.productNameSnapshot,
      amountCents: checkout.amountCents,
      commissionCents: checkout.commissionCents,
    });
  }

  /** WhatsApp no número de aviso (≠ WA de vendas) após pagamento. */
  private async notifyMerchantOrderWhatsApp(checkoutId: string) {
    const checkout = await this.prisma.checkout.findUnique({
      where: { id: checkoutId },
      include: { customer: true, store: true },
    });
    if (!checkout?.store.orderNotifyPhoneE164) return;
    if (checkout.orderNotifiedAt) return;

    const lines = parsePaidLinesJson(checkout.paidLinesJson);
    const items =
      lines.length > 0
        ? lines.map((l) => l.productNameSnapshot).join(', ')
        : checkout.productNameSnapshot;
    const productsCents =
      lines.reduce((s, l) => s + l.amountCents, 0) ||
      Math.max(0, checkout.amountCents - checkout.shippingCents);
    const method =
      checkout.fulfillmentMethod === 'delivery'
        ? 'Entrega'
        : 'Retirada na loja';
    let addressBlock = method;
    if (
      checkout.fulfillmentMethod === 'delivery' &&
      checkout.shippingAddressJson
    ) {
      const a = JSON.parse(checkout.shippingAddressJson) as ShippingAddress;
      addressBlock = `Entrega: ${a.recipientName}, ${a.street}, ${a.number}${a.complement ? ' ' + a.complement : ''} — ${a.neighborhood}, ${a.city}/${a.state}, CEP ${a.cep}, tel ${a.phoneE164}`;
    } else if (checkout.store.pickupAddressText) {
      addressBlock = `Retirada: ${checkout.store.pickupAddressText}`;
    }

    const body = [
      `Nova venda Voltou · ${checkout.couponCode ?? checkout.id.slice(0, 8)}`,
      items,
      `Produtos: R$ ${(productsCents / 100).toFixed(2)} · Frete: R$ ${(checkout.shippingCents / 100).toFixed(2)} · Total: R$ ${(checkout.amountCents / 100).toFixed(2)}`,
      addressBlock,
      'Abra o painel Pedidos para atualizar o status.',
    ].join('\n');

    await this.whatsapp.send({
      tenantId: checkout.tenantId,
      storeId: checkout.storeId,
      to: checkout.store.orderNotifyPhoneE164,
      body,
    });

    await this.prisma.checkout.update({
      where: { id: checkout.id },
      data: { orderNotifiedAt: new Date() },
    });
  }

  async listPaidOrders(
    tenantId: string,
    storeId: string,
    fulfillmentStatus?: string,
  ) {
    const rows = await this.prisma.checkout.findMany({
      where: {
        tenantId,
        storeId,
        status: 'paid',
        ...(fulfillmentStatus ? { fulfillmentStatus } : {}),
      },
      include: { customer: true },
      orderBy: { paidAt: 'desc' },
      take: 100,
    });
    const tr = await this.prisma.$queryRawUnsafe<
      { id: string; trackingCode: string | null }[]
    >(
      'SELECT id, trackingCode FROM Checkout WHERE tenantId = ? AND storeId = ? AND status = ?',
      tenantId,
      storeId,
      'paid',
    );
    const tm = new Map(tr.map((x) => [x.id, x.trackingCode]));
    return rows.map((c) => ({
      id: c.id,
      couponCode: c.couponCode,
      productName: c.productNameSnapshot,
      amountCents: c.amountCents,
      shippingCents: c.shippingCents,
      commissionCents: c.commissionCents,
      fulfillmentMethod: c.fulfillmentMethod,
      fulfillmentStatus: c.fulfillmentStatus,
      trackingCode: tm.get(c.id) ?? null,
      shippingAddress: c.shippingAddressJson
        ? (JSON.parse(c.shippingAddressJson) as ShippingAddress)
        : null,
      paidLines: parsePaidLinesJson(c.paidLinesJson),
      customerName: c.customer.displayName,
      paidAt: c.paidAt,
    }));
  }

  /**
   * Owner sets/clears `trackingCode` on a paid checkout (home delivery only).
   * Returns the checkout row like prod, but the customer relation never
   * includes phoneEnc/phoneHash (intentional fix vs prod, which leaked them).
   */
  async updateFulfillment(
    checkoutId: string,
    tenantId: string,
    input: { storeId?: string; trackingCode?: unknown },
  ) {
    const checkout = await this.prisma.checkout.findFirst({
      where: {
        id: checkoutId,
        tenantId,
        status: 'paid',
        ...(input.storeId ? { storeId: input.storeId } : {}),
      },
      include: { customer: { omit: { phoneEnc: true, phoneHash: true } } },
    });
    if (!checkout) throw new NotFoundException('Pedido nao encontrado.');
    if (input.trackingCode === undefined) return checkout;
    assertTrackingAllowed(checkout.fulfillmentMethod);
    const trackingCode = normalizeTrackingCode(input.trackingCode);
    await this.prisma.$executeRawUnsafe(
      'UPDATE Checkout SET trackingCode = ? WHERE id = ?',
      trackingCode,
      checkout.id,
    );
    return { ...checkout, trackingCode };
  }
}

function firstName(displayName: string) {
  const part = displayName.trim().split(/\s+/)[0] ?? '';
  return part || 'Cliente';
}
