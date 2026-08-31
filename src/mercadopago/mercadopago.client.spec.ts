import { MercadoPagoClient } from './mercadopago.client';

describe('MercadoPagoClient.createPayment', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('POSTs /v1/payments with seller token and never sends application_fee', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          id: 11,
          status: 'pending',
          status_detail: 'pending_waiting_transfer',
          point_of_interaction: {
            transaction_data: { qr_code: 'pix-copy' },
          },
        }),
    });
    global.fetch = fetchMock;

    const client = new MercadoPagoClient();
    const payment = await client.createPayment('SELLER-OAUTH-TOKEN', {
      amountCents: 500,
      description: 'Principal',
      paymentMethodId: 'pix',
      payerEmail: 'teste.checkout@voltouapp.com',
      externalReference: 'chk-1',
      notificationUrl: 'https://api.example/mercadopago/webhook',
      commissionCents: 25,
      idempotencyKey: 'idem-1',
    });

    expect(payment.paymentId).toBe(11);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [
      string,
      { method: string; headers: Record<string, string>; body: string },
    ];
    expect(url).toBe('https://api.mercadopago.com/v1/payments');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer SELLER-OAUTH-TOKEN');
    expect(init.headers['X-Idempotency-Key']).toBe('idem-1');
    const body = JSON.parse(init.body) as Record<string, unknown>;
    expect(body).not.toHaveProperty('application_fee');
    expect(body).not.toHaveProperty('collector_id');
    expect(body.payment_method_id).toBe('pix');
  });

  it('forwards Mercado Pago seller/Pix identity errors without changing the request', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: () =>
        Promise.resolve({
          message: 'Error in Financial Identity Use Case',
          error: 'bad_request',
        }),
    });

    const client = new MercadoPagoClient();
    await expect(
      client.createPayment('SELLER-OAUTH-TOKEN', {
        amountCents: 500,
        description: 'Principal',
        paymentMethodId: 'pix',
        payerEmail: 'a@b.com',
        externalReference: 'chk-1',
        notificationUrl: 'https://api.example/mercadopago/webhook',
        commissionCents: 25,
        idempotencyKey: 'idem-2',
      }),
    ).rejects.toThrow('Error in Financial Identity Use Case');
  });
});
