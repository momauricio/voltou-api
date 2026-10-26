import { BadRequestException } from '@nestjs/common';
import { CheckoutService } from './checkout.service';
import { OffersController } from './offers.controller';

const tenantId = 'tenant-1';
const storeId = 'store-1';

const address = {
  recipientName: 'Marina Silva',
  phone: '(11) 98765-4321',
  cep: '01310-100',
  street: 'Av Paulista',
  number: '1000',
  complement: 'ap 12',
  neighborhood: 'Bela Vista',
  city: 'São Paulo',
  state: 'sp',
};

function makeStore(overrides: Record<string, unknown> = {}) {
  return {
    id: storeId,
    tenantId,
    name: 'Loja',
    slug: 'loja',
    deliveryEnabled: true,
    shippingCents: 1500,
    pickupAddressText: 'Rua Retirada, 1',
    orderNotifyPhoneE164: '+5511999990000',
    checkoutLogoUrl: null,
    checkoutPrimaryColor: null,
    checkoutSecondaryColor: null,
    checkoutFontFamily: null,
    checkoutMessage: null,
    ...overrides,
  };
}

function makeCheckout(overrides: Record<string, unknown> = {}) {
  return {
    id: 'chk-1',
    tenantId,
    storeId,
    customerId: 'cust-1',
    productId: 'prod-1',
    productNameSnapshot: 'Tênis',
    amountCents: 10000,
    listPriceCents: 10000,
    discountBps: 0,
    commissionRateBps: 500,
    commissionCents: 500,
    couponCode: 'ANA10ABCD',
    status: 'pending',
    expiresAt: null,
    paidAt: null,
    createdBy: 'human',
    interestId: null,
    mpPaymentId: null,
    addonsJson: JSON.stringify([
      {
        id: 'addon-1',
        productId: 'prod-2',
        productNameSnapshot: 'Meia',
        listPriceCents: 2000,
        discountBps: 0,
        selectedByDefault: false,
      },
    ]),
    paidLinesJson: null,
    fulfillmentMethod: null,
    fulfillmentStatus: null,
    shippingCents: 0,
    shippingAddressJson: null,
    orderNotifiedAt: null,
    customer: { displayName: 'Ana Souza' },
    store: makeStore(),
    product: null,
    ...overrides,
  };
}

function setup(opts: { store?: Record<string, unknown>; payment?: unknown } = {}) {
  const store = makeStore(opts.store);
  const checkout = makeCheckout({ store });
  const prisma = {
    store: {
      findFirst: jest.fn().mockResolvedValue(store),
      findUniqueOrThrow: jest.fn().mockResolvedValue(store),
    },
    checkout: {
      findFirst: jest.fn().mockResolvedValue(checkout),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn().mockResolvedValue(checkout),
      update: jest.fn().mockResolvedValue(checkout),
    },
    storeKnowledge: { findFirst: jest.fn().mockResolvedValue(null) },
    sale: { findMany: jest.fn().mockResolvedValue([]), create: jest.fn() },
    customerInterest: { updateMany: jest.fn() },
    customerEvent: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
    },
    user: { findFirst: jest.fn().mockResolvedValue(null) },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation((cb: (tx: unknown) => unknown) =>
    cb(prisma),
  );
  const email = { sendPaymentReceived: jest.fn() };
  const whatsapp = { send: jest.fn().mockResolvedValue(undefined) };
  const paymentProvider = {
    id: 'mercadopago',
    isConnected: jest.fn().mockResolvedValue(true),
  };
  const mercadoPago = {
    isConnected: jest.fn().mockResolvedValue(true),
    getSellerPublicKey: jest.fn().mockResolvedValue('APP_USR-seller'),
    createTransparentPayment: jest.fn().mockResolvedValue(
      opts.payment ?? {
        id: 123,
        status: 'pending',
        status_detail: 'pending_waiting_transfer',
        point_of_interaction: {
          transaction_data: {
            qr_code: 'pix-copy',
            qr_code_base64: 'b64',
            ticket_url: 'https://mp/ticket',
          },
        },
      },
    ),
  };
  const service = new CheckoutService(
    prisma as never,
    email as never,
    whatsapp as never,
    paymentProvider as never,
    mercadoPago as never,
  );
  return { service, prisma, whatsapp, mercadoPago, paymentProvider, checkout };
}

const pixInput = {
  paymentMethodId: ' PIX ',
  payerEmail: ' ana@cliente.com ',
  selectedAddonIds: ['addon-1'],
};

describe('CheckoutService.createTransparentPayment (prod parity)', () => {
  it('delivery: charges products + store shipping, commission on products only, persists address', async () => {
    const { service, prisma, mercadoPago } = setup();

    const res = await service.createTransparentPayment('loja', 'ana10abcd', {
      ...pixInput,
      fulfillmentMethod: 'delivery',
      shippingAddress: address,
    });

    const firstUpdate = prisma.checkout.update.mock.calls[0][0];
    expect(firstUpdate.where).toEqual({ id: 'chk-1' });
    expect(firstUpdate.data).toMatchObject({
      commissionCents: 600,
      provider: 'mercadopago',
      fulfillmentMethod: 'delivery',
      shippingCents: 1500,
    });
    expect(JSON.parse(firstUpdate.data.shippingAddressJson)).toEqual({
      recipientName: 'Marina Silva',
      phoneE164: '+5511987654321',
      cep: '01310100',
      street: 'Av Paulista',
      number: '1000',
      complement: 'ap 12',
      neighborhood: 'Bela Vista',
      city: 'São Paulo',
      state: 'SP',
    });

    const call = mercadoPago.createTransparentPayment.mock.calls[0][0];
    expect(call).toMatchObject({
      tenantId,
      storeId,
      checkoutId: 'chk-1',
      amountCents: 13500,
      commissionCents: 600,
      description: 'Tênis + Meia',
      paymentMethodId: 'pix',
      payerEmail: 'ana@cliente.com',
    });
    expect(call.idempotencyKey).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );

    expect(prisma.checkout.update.mock.calls[1][0]).toEqual({
      where: { id: 'chk-1' },
      data: { providerRef: '123', mpPaymentId: '123' },
    });
    expect(res).toEqual({
      paymentId: 123,
      status: 'pending',
      statusDetail: 'pending_waiting_transfer',
      amountCents: 13500,
      pixQrCode: 'pix-copy',
      pixQrCodeBase64: 'b64',
      pixTicketUrl: 'https://mp/ticket',
    });
  });

  it('uses a fresh idempotency key on every attempt', async () => {
    const { service, mercadoPago } = setup();
    const input = { ...pixInput, fulfillmentMethod: 'pickup' as const };
    await service.createTransparentPayment('loja', 'ANA10ABCD', input);
    await service.createTransparentPayment('loja', 'ANA10ABCD', input);
    const [a, b] = mercadoPago.createTransparentPayment.mock.calls.map(
      (c) => c[0].idempotencyKey,
    );
    expect(a).not.toBe(b);
  });

  it('pickup: no shipping, no address', async () => {
    const { service, prisma, mercadoPago } = setup();

    await service.createTransparentPayment('loja', 'ANA10ABCD', {
      ...pixInput,
      selectedAddonIds: [],
      fulfillmentMethod: 'pickup',
      shippingAddress: address,
    });

    expect(prisma.checkout.update.mock.calls[0][0].data).toMatchObject({
      fulfillmentMethod: 'pickup',
      shippingCents: 0,
      shippingAddressJson: null,
    });
    expect(mercadoPago.createTransparentPayment.mock.calls[0][0]).toMatchObject({
      amountCents: 10000,
      commissionCents: 500,
      description: 'Tênis',
    });
  });

  it('rejects delivery when the store disabled it', async () => {
    const { service, mercadoPago } = setup({ store: { deliveryEnabled: false } });
    await expect(
      service.createTransparentPayment('loja', 'ANA10ABCD', {
        ...pixInput,
        fulfillmentMethod: 'delivery',
        shippingAddress: address,
      }),
    ).rejects.toThrow('Esta loja não oferece entrega no momento.');
    expect(mercadoPago.createTransparentPayment).not.toHaveBeenCalled();
  });

  it('rejects an invalid delivery address with the parser message', async () => {
    const { service } = setup();
    await expect(
      service.createTransparentPayment('loja', 'ANA10ABCD', {
        ...pixInput,
        fulfillmentMethod: 'delivery',
        shippingAddress: { ...address, cep: '123' },
      }),
    ).rejects.toThrow('CEP inválido.');
    await expect(
      service.createTransparentPayment('loja', 'ANA10ABCD', {
        ...pixInput,
        fulfillmentMethod: 'delivery',
      }),
    ).rejects.toThrow('Endereço de entrega obrigatório.');
  });

  it('requires a card token for non-Pix methods', async () => {
    const { service } = setup();
    await expect(
      service.createTransparentPayment('loja', 'ANA10ABCD', {
        paymentMethodId: 'master',
        payerEmail: 'ana@cliente.com',
        fulfillmentMethod: 'pickup',
      }),
    ).rejects.toThrow('Token do cartão obrigatório.');
  });

  it('wraps MP errors in a 400 with the MP message', async () => {
    const { service, mercadoPago } = setup();
    mercadoPago.createTransparentPayment.mockRejectedValue(
      new Error('Invalid card'),
    );
    await expect(
      service.createTransparentPayment('loja', 'ANA10ABCD', {
        ...pixInput,
        fulfillmentMethod: 'pickup',
      }),
    ).rejects.toEqual(new BadRequestException('Invalid card'));
  });

  it('approved: markPaid adds shipping, sets fulfillmentStatus awaiting and alerts the merchant on WhatsApp', async () => {
    const { service, prisma, whatsapp } = setup({
      payment: { id: 777, status: 'approved' },
    });
    const paidLines = JSON.stringify([
      { kind: 'principal', productId: 'prod-1', productNameSnapshot: 'Tênis', amountCents: 10000 },
      { kind: 'addon', addonId: 'addon-1', productId: 'prod-2', productNameSnapshot: 'Meia', amountCents: 2000 },
    ]);
    const shippingAddressJson = JSON.stringify({
      recipientName: 'Marina Silva',
      phoneE164: '+5511987654321',
      cep: '01310100',
      street: 'Av Paulista',
      number: '1000',
      complement: 'ap 12',
      neighborhood: 'Bela Vista',
      city: 'São Paulo',
      state: 'SP',
    });
    const pendingRow = makeCheckout({
      paidLinesJson: paidLines,
      fulfillmentMethod: 'delivery',
      shippingCents: 1500,
      shippingAddressJson,
    });
    const paidRow = {
      ...pendingRow,
      status: 'paid',
      amountCents: 13500,
      commissionCents: 600,
      fulfillmentStatus: 'awaiting',
    };
    prisma.checkout.findFirst
      .mockResolvedValueOnce(makeCheckout()) // public lookup
      .mockResolvedValueOnce(pendingRow); // markPaid tx
    prisma.checkout.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
      data.status === 'paid' ? paidRow : pendingRow,
    );
    prisma.checkout.findUnique.mockResolvedValue({
      ...paidRow,
      store: makeStore(),
      customer: { displayName: 'Ana Souza' },
    });

    await service.createTransparentPayment('loja', 'ANA10ABCD', {
      ...pixInput,
      fulfillmentMethod: 'delivery',
      shippingAddress: address,
    });

    const paidUpdate = prisma.checkout.update.mock.calls.find(
      (c) => c[0].data.status === 'paid',
    )?.[0];
    expect(paidUpdate.data).toMatchObject({
      status: 'paid',
      amountCents: 12000 + 1500,
      fulfillmentStatus: 'awaiting',
      mpPaymentId: '777',
    });

    await new Promise((r) => setImmediate(r));
    expect(whatsapp.send).toHaveBeenCalledWith({
      tenantId,
      storeId,
      to: '+5511999990000',
      body: [
        'Nova venda Voltou · ANA10ABCD',
        'Tênis, Meia',
        'Produtos: R$ 120.00 · Frete: R$ 15.00 · Total: R$ 135.00',
        'Entrega: Marina Silva, Av Paulista, 1000 ap 12 — Bela Vista, São Paulo/SP, CEP 01310100, tel +5511987654321',
        'Abra o painel Pedidos para atualizar o status.',
      ].join('\n'),
    });
    expect(prisma.checkout.update).toHaveBeenCalledWith({
      where: { id: 'chk-1' },
      data: { orderNotifiedAt: expect.any(Date) },
    });
  });
});

describe('CheckoutService.getPublicOffer payment fields (prod parity)', () => {
  it('always reports transparent mode and asks MP for the seller key', async () => {
    const { service, mercadoPago, paymentProvider } = setup();
    const res = await service.getPublicOffer('loja', 'ANA10ABCD');
    expect(paymentProvider.isConnected).toHaveBeenCalledWith(tenantId, storeId);
    expect(mercadoPago.getSellerPublicKey).toHaveBeenCalledWith(tenantId, storeId);
    expect(res).toMatchObject({
      paymentMode: 'transparent',
      mpPublicKey: 'APP_USR-seller',
      canPay: true,
      deliveryEnabled: true,
      shippingCents: 1500,
      pickupAddressText: 'Rua Retirada, 1',
    });
  });

  it('canPay is false without a public key (still transparent)', async () => {
    const { service, mercadoPago } = setup();
    mercadoPago.getSellerPublicKey.mockResolvedValue(null);
    const res = await service.getPublicOffer('loja', 'ANA10ABCD');
    expect(res).toMatchObject({
      paymentMode: 'transparent',
      mpPublicKey: null,
      canPay: false,
    });
  });
});

describe('OffersController POST payments validation (prod parity)', () => {
  const service = { createTransparentPayment: jest.fn().mockResolvedValue({}) };
  const controller = new OffersController(service as never);

  beforeEach(() => service.createTransparentPayment.mockClear());

  it('requires fulfillmentMethod with the prod message', () => {
    expect(() =>
      controller.createPayment('loja', 'C', {
        paymentMethodId: 'pix',
        payerEmail: 'a@b.c',
      }),
    ).toThrow('Escolha retirar na loja ou receber em casa.');
  });

  it('requires paymentMethodId and payerEmail', () => {
    expect(() =>
      controller.createPayment('loja', 'C', { payerEmail: 'a@b.c' }),
    ).toThrow('paymentMethodId é obrigatório.');
    expect(() =>
      controller.createPayment('loja', 'C', { paymentMethodId: 'pix' }),
    ).toThrow('payerEmail é obrigatório.');
  });

  it('accepts a numeric issuerId via String()', () => {
    void controller.createPayment('loja', 'C', {
      paymentMethodId: 'master',
      payerEmail: 'a@b.c',
      token: 'tok',
      issuerId: 24,
      fulfillmentMethod: 'pickup',
    });
    expect(service.createTransparentPayment).toHaveBeenCalledWith('loja', 'C', {
      selectedAddonIds: [],
      paymentMethodId: 'master',
      token: 'tok',
      installments: undefined,
      issuerId: '24',
      payerEmail: 'a@b.c',
      payerIdentification: undefined,
      fulfillmentMethod: 'pickup',
      shippingAddress: undefined,
    });
  });
});
