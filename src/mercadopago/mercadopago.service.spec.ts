import { UnauthorizedException } from '@nestjs/common';
import { createHmac } from 'crypto';
import { MercadoPagoService } from './mercadopago.service';

describe('MercadoPagoService.getSellerPublicKey', () => {
  const prevPublicKey = process.env.MP_PUBLIC_KEY;

  afterEach(() => {
    if (prevPublicKey === undefined) delete process.env.MP_PUBLIC_KEY;
    else process.env.MP_PUBLIC_KEY = prevPublicKey;
  });

  it('prefers the integrator/marketplace MP_PUBLIC_KEY over the seller key', () => {
    process.env.MP_PUBLIC_KEY = 'APP_USR-integrator-pk';
    const service = new MercadoPagoService({} as never, {} as never);
    expect(service.getSellerPublicKey('APP_USR-seller-pk')).toBe(
      'APP_USR-integrator-pk',
    );
  });

  it('falls back to the seller key when MP_PUBLIC_KEY is empty', () => {
    delete process.env.MP_PUBLIC_KEY;
    const service = new MercadoPagoService({} as never, {} as never);
    expect(service.getSellerPublicKey('APP_USR-seller-pk')).toBe(
      'APP_USR-seller-pk',
    );
  });

  it('trims MP_PUBLIC_KEY and ignores a blank seller key', () => {
    process.env.MP_PUBLIC_KEY = '  APP_USR-integrator-pk  ';
    const service = new MercadoPagoService({} as never, {} as never);
    expect(service.getSellerPublicKey('   ')).toBe('APP_USR-integrator-pk');
  });
});

describe('MercadoPagoService.createTransparentPayment', () => {
  it('forwards commissionCents as applicationFeeCents and does not send collector_id', async () => {
    const createPayment = jest.fn().mockResolvedValue({
      paymentId: 11,
      status: 'pending',
      statusDetail: 'pending_waiting_transfer',
      amountCents: 500,
      pixQrCode: null,
      pixQrCodeBase64: null,
      pixTicketUrl: null,
    });
    const prisma = {
      mercadoPagoConnection: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'conn-1',
          status: 'connected',
          expiresAt: new Date(Date.now() + 3600_000),
          accessTokenEnc: 'enc',
        }),
      },
    };
    const decrypt = jest
      .spyOn(
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../common/secret.util') as typeof import('../common/secret.util'),
        'decryptSecret',
      )
      .mockReturnValue('SELLER-OAUTH-TOKEN');

    const service = new MercadoPagoService(prisma as never, {
      assertConfigured: jest.fn(),
      createPayment,
    } as never);

    await service.createTransparentPayment({
      tenantId: 'tenant-1',
      storeId: 'store-1',
      checkoutId: 'chk-1',
      amountCents: 500,
      commissionCents: 25,
      title: 'Principal',
      paymentMethodId: 'pix',
      payerEmail: 'teste.checkout@voltouapp.com',
    });

    expect(createPayment).toHaveBeenCalledWith(
      'SELLER-OAUTH-TOKEN',
      expect.objectContaining({
        applicationFeeCents: 25,
        externalReference: 'chk-1',
      }),
    );
    const payload = createPayment.mock.calls[0][1] as Record<string, unknown>;
    expect(payload).not.toHaveProperty('collector_id');
    decrypt.mockRestore();
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
    ).rejects.toBeInstanceOf(UnauthorizedException);
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
});
