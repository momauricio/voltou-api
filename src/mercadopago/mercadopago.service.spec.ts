import { UnauthorizedException } from '@nestjs/common';
import { createHmac } from 'crypto';
import { MercadoPagoService } from './mercadopago.service';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const secretUtil = require('../common/secret.util') as typeof import('../common/secret.util');

function connectedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'conn-1',
    tenantId: 'tenant-1',
    storeId: 'store-1',
    status: 'connected',
    expiresAt: new Date(Date.now() + 3600_000),
    accessTokenEnc: 'enc',
    publicKey: null as string | null,
    ...overrides,
  };
}

describe('MercadoPagoService.getSellerPublicKey', () => {
  const prevPublicKey = process.env.MP_PUBLIC_KEY;
  let decrypt: jest.SpyInstance;

  beforeEach(() => {
    delete process.env.MP_PUBLIC_KEY;
    decrypt = jest
      .spyOn(secretUtil, 'decryptSecret')
      .mockReturnValue('SELLER-OAUTH-TOKEN');
  });

  afterEach(() => {
    decrypt.mockRestore();
    if (prevPublicKey === undefined) delete process.env.MP_PUBLIC_KEY;
    else process.env.MP_PUBLIC_KEY = prevPublicKey;
  });

  function make(row: unknown, resolved: string | null = null) {
    const prisma = {
      mercadoPagoConnection: {
        findUnique: jest.fn().mockResolvedValue(row),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const mp = {
      assertConfigured: jest.fn(),
      resolvePublicKey: jest.fn().mockResolvedValue(resolved),
    };
    return {
      prisma,
      mp,
      service: new MercadoPagoService(prisma as never, mp as never),
    };
  }

  it('prefers the trimmed integrator MP_PUBLIC_KEY without touching the DB', async () => {
    process.env.MP_PUBLIC_KEY = '  APP_USR-integrator-pk  ';
    const { service, prisma } = make(connectedRow({ publicKey: 'APP_USR-seller' }));
    await expect(service.getSellerPublicKey('tenant-1', 'store-1')).resolves.toBe(
      'APP_USR-integrator-pk',
    );
    expect(prisma.mercadoPagoConnection.findUnique).not.toHaveBeenCalled();
  });

  it('returns the stored connection publicKey', async () => {
    const { service, mp } = make(connectedRow({ publicKey: ' APP_USR-seller ' }));
    await expect(service.getSellerPublicKey('tenant-1', 'store-1')).resolves.toBe(
      'APP_USR-seller',
    );
    expect(mp.resolvePublicKey).not.toHaveBeenCalled();
  });

  it('returns null when the store is not connected', async () => {
    const { service } = make(connectedRow({ status: 'expired' }));
    await expect(
      service.getSellerPublicKey('tenant-1', 'store-1'),
    ).resolves.toBeNull();
  });

  it('resolves the key via MP API and persists it', async () => {
    const { service, mp, prisma } = make(connectedRow(), 'APP_USR-resolved');
    await expect(service.getSellerPublicKey('tenant-1', 'store-1')).resolves.toBe(
      'APP_USR-resolved',
    );
    expect(mp.resolvePublicKey).toHaveBeenCalledWith('SELLER-OAUTH-TOKEN');
    expect(prisma.mercadoPagoConnection.update).toHaveBeenCalledWith({
      where: { id: 'conn-1' },
      data: { publicKey: 'APP_USR-resolved' },
    });
  });

  it('returns null (no write) when MP cannot resolve the key', async () => {
    const { service, prisma } = make(connectedRow(), null);
    await expect(
      service.getSellerPublicKey('tenant-1', 'store-1'),
    ).resolves.toBeNull();
    expect(prisma.mercadoPagoConnection.update).not.toHaveBeenCalled();
  });
});

describe('MercadoPagoService.createTransparentPayment', () => {
  it('sends application_fee, metadata and the caller idempotency key; no collector_id', async () => {
    const createPayment = jest.fn().mockResolvedValue({ id: 11, status: 'pending' });
    const prisma = {
      mercadoPagoConnection: {
        findUnique: jest.fn().mockResolvedValue(connectedRow()),
      },
    };
    const decrypt = jest
      .spyOn(secretUtil, 'decryptSecret')
      .mockReturnValue('SELLER-OAUTH-TOKEN');
    const prevApi = process.env.API_PUBLIC_URL;
    process.env.API_PUBLIC_URL = 'https://api.example';

    const service = new MercadoPagoService(prisma as never, {
      assertConfigured: jest.fn(),
      createPayment,
    } as never);

    const payment = await service.createTransparentPayment({
      tenantId: 'tenant-1',
      storeId: 'store-1',
      checkoutId: 'chk-1',
      amountCents: 500,
      commissionCents: 25,
      description: 'Principal + Meia',
      paymentMethodId: 'pix',
      payerEmail: 'teste.checkout@voltouapp.com',
      idempotencyKey: 'idem-uuid',
    });

    expect(payment).toEqual({ id: 11, status: 'pending' });
    expect(createPayment).toHaveBeenCalledWith(
      'SELLER-OAUTH-TOKEN',
      {
        transactionAmount: 5,
        description: 'Principal + Meia',
        paymentMethodId: 'pix',
        installments: undefined,
        token: undefined,
        issuerId: undefined,
        payerEmail: 'teste.checkout@voltouapp.com',
        payerIdentification: undefined,
        externalReference: 'chk-1',
        applicationFee: 0.25,
        notificationUrl: 'https://api.example/mercadopago/webhook',
        metadata: { checkout_id: 'chk-1', source: 'voltou_transparent' },
      },
      'idem-uuid',
    );
    const payload = createPayment.mock.calls[0][1] as Record<string, unknown>;
    expect(payload).not.toHaveProperty('collector_id');
    decrypt.mockRestore();
    if (prevApi === undefined) delete process.env.API_PUBLIC_URL;
    else process.env.API_PUBLIC_URL = prevApi;
  });
});

describe('MercadoPagoService.handleWebhook', () => {
  const prisma = {
    webhookLog: {
      create: jest.fn().mockResolvedValue({ id: 'log-1' }),
      update: jest.fn().mockResolvedValue({}),
    },
    mercadoPagoConnection: { findMany: jest.fn() },
    checkout: { findUnique: jest.fn(), findFirst: jest.fn() },
  };
  const mp = { getPayment: jest.fn() };
  const service = new MercadoPagoService(prisma as never, mp as never);
  const prevSecret = process.env.MP_WEBHOOK_SECRET;

  afterEach(() => {
    jest.clearAllMocks();
    if (prevSecret === undefined) delete process.env.MP_WEBHOOK_SECRET;
    else process.env.MP_WEBHOOK_SECRET = prevSecret;
  });

  it('refuses the notification when MP_WEBHOOK_SECRET is empty', async () => {
    delete process.env.MP_WEBHOOK_SECRET;
    await expect(
      service.handleWebhook({}, { type: 'payment', data: { id: 'pay-1' } }, {}),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.mercadoPagoConnection.findMany).not.toHaveBeenCalled();
    expect(prisma.webhookLog.create).not.toHaveBeenCalled();
  });

  it('refuses the notification when MP_WEBHOOK_SECRET is blank', async () => {
    process.env.MP_WEBHOOK_SECRET = '   ';
    await expect(
      service.handleWebhook({}, { type: 'payment', data: { id: 'pay-1' } }, {}),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.mercadoPagoConnection.findMany).not.toHaveBeenCalled();
  });

  it('throws when the x-signature does not match', async () => {
    process.env.MP_WEBHOOK_SECRET = 'mp-webhook-secret';
    await expect(
      service.handleWebhook(
        {},
        { type: 'payment', data: { id: 'pay-1' } },
        { 'x-signature': 'ts=1,v1=deadbeef', 'x-request-id': 'req-1' },
      ),
    ).rejects.toThrow('Assinatura inválida do webhook Mercado Pago.');
    expect(prisma.mercadoPagoConnection.findMany).not.toHaveBeenCalled();
  });

  it('processes after a valid signature', async () => {
    const secret = 'mp-webhook-secret';
    process.env.MP_WEBHOOK_SECRET = secret;
    const ts = '1710000000';
    const requestId = 'req-1';
    const dataId = 'pay-1';
    const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
    const hash = createHmac('sha256', secret).update(manifest).digest('hex');
    prisma.mercadoPagoConnection.findMany.mockResolvedValue([]);

    const result = await service.handleWebhook(
      {},
      { type: 'payment', data: { id: dataId } },
      { 'x-signature': `ts=${ts},v1=${hash}`, 'x-request-id': requestId },
    );

    expect(result).toEqual({
      ignored: true,
      reason: 'pagamento não encontrado',
    });
    expect(prisma.mercadoPagoConnection.findMany).toHaveBeenCalled();
  });

  it('ignores a non-approved payment with its status (fix vs prod ReferenceError)', async () => {
    const secret = 'mp-webhook-secret';
    process.env.MP_WEBHOOK_SECRET = secret;
    const ts = '1710000000';
    const requestId = 'req-2';
    const dataId = 'pay-2';
    const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
    const hash = createHmac('sha256', secret).update(manifest).digest('hex');
    prisma.mercadoPagoConnection.findMany.mockResolvedValue([
      { tenantId: 'tenant-1', storeId: 'store-1' },
    ]);
    jest
      .spyOn(service as unknown as { getValidAccessToken: () => Promise<string> }, 'getValidAccessToken')
      .mockResolvedValue('TOKEN');
    mp.getPayment.mockResolvedValue({
      id: 99,
      status: 'pending',
      external_reference: 'chk-1',
    });
    prisma.checkout.findFirst.mockResolvedValue({ id: 'chk-1' });

    const result = await service.handleWebhook(
      {},
      { type: 'payment', data: { id: dataId } },
      { 'x-signature': `ts=${ts},v1=${hash}`, 'x-request-id': requestId },
    );

    expect(result).toEqual({
      ignored: true,
      reason: 'status=pending',
      checkoutId: 'chk-1',
      paymentId: '99',
    });
    expect(prisma.webhookLog.update).toHaveBeenCalledTimes(1);
    expect(prisma.webhookLog.update).toHaveBeenCalledWith({
      where: { id: 'log-1' },
      data: { processedOk: true, error: 'status=pending' },
    });
  });
});
