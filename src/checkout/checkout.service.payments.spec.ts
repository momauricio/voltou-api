import { CheckoutService } from './checkout.service';
import type { PaymentProvider } from './payment-provider';

function checkoutRow() {
  return {
    id: 'chk-1',
    tenantId: 'tenant-1',
    storeId: 'store-1',
    productId: 'prod-1',
    productNameSnapshot: 'Principal',
    amountCents: 500,
    listPriceCents: 500,
    discountBps: 0,
    commissionRateBps: 500,
    commissionCents: 0,
    status: 'pending',
    expiresAt: new Date(Date.now() + 3600_000),
    addonsJson: null,
    couponCode: 'CLIENTE106F9F',
    store: { id: 'store-1', slug: 'principal', name: 'Loja' },
    customer: { displayName: 'Cliente' },
    product: { id: 'prod-1', name: 'Principal' },
  };
}

describe('CheckoutService.createPublicPayment', () => {
  it('persists commissionCents after a seller-token Pix charge', async () => {
    const row = checkoutRow();
    const updates: Record<string, unknown>[] = [];
    const prisma = {
      store: {
        findFirst: jest.fn().mockResolvedValue(row.store),
      },
      checkout: {
        findFirst: jest.fn().mockResolvedValue(row),
        update: jest.fn(({ data }: { data: Record<string, unknown> }) => {
          updates.push(data);
          return Promise.resolve({ ...row, ...data });
        }),
      },
      storeKnowledge: { findFirst: jest.fn().mockResolvedValue(null) },
    };

    const createTransparentPayment = jest.fn().mockResolvedValue({
      paymentId: 77,
      status: 'pending',
      statusDetail: 'pending_waiting_transfer',
      amountCents: 500,
      pixQrCode: '000201',
      pixQrCodeBase64: 'iVBOR',
      pixTicketUrl: 'https://mp.example/ticket',
    });
    const paymentProvider: PaymentProvider = {
      id: 'mercadopago',
      isConnected: jest.fn().mockResolvedValue(true),
      getPublicKey: () => 'APP_USR-pk',
      createPaymentLink: jest.fn(),
      createTransparentPayment,
    };

    const service = new CheckoutService(
      prisma as never,
      { sendPaymentReceived: jest.fn() } as never,
      paymentProvider,
    );

    const result = await service.createPublicPayment(
      'principal',
      'CLIENTE106F9F',
      {
        selectedAddonIds: [],
        paymentMethodId: 'pix',
        payerEmail: 'teste.checkout@voltouapp.com',
        fulfillmentMethod: 'pickup',
      },
    );

    expect(result.paymentId).toBe(77);
    expect(result.status).toBe('pending');
    expect(createTransparentPayment).toHaveBeenCalledWith(
      expect.objectContaining({
        checkoutId: 'chk-1',
        amountCents: 500,
        paymentMethodId: 'pix',
        payerEmail: 'teste.checkout@voltouapp.com',
      }),
    );
    expect(updates[0]).toMatchObject({
      commissionCents: 25,
      mpPaymentId: '77',
      provider: 'mercadopago',
    });
  });

  it('rejects card charges without a token', async () => {
    const row = checkoutRow();
    const prisma = {
      store: { findFirst: jest.fn().mockResolvedValue(row.store) },
      checkout: { findFirst: jest.fn().mockResolvedValue(row) },
      storeKnowledge: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const createTransparentPayment = jest.fn();
    const paymentProvider: PaymentProvider = {
      id: 'mercadopago',
      isConnected: jest.fn().mockResolvedValue(true),
      getPublicKey: () => 'APP_USR-pk',
      createPaymentLink: jest.fn(),
      createTransparentPayment,
    };
    const service = new CheckoutService(
      prisma as never,
      { sendPaymentReceived: jest.fn() } as never,
      paymentProvider,
    );

    await expect(
      service.createPublicPayment('principal', 'CLIENTE106F9F', {
        selectedAddonIds: [],
        paymentMethodId: 'master',
        payerEmail: 'teste.checkout@voltouapp.com',
        fulfillmentMethod: 'pickup',
      }),
    ).rejects.toMatchObject({
      message: 'Token do cartão obrigatório.',
    });
    expect(createTransparentPayment).not.toHaveBeenCalled();
  });
});
