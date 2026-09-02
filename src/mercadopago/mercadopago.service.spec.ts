import { UnauthorizedException } from '@nestjs/common';
import { createHmac } from 'crypto';
import { MercadoPagoService } from './mercadopago.service';

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
