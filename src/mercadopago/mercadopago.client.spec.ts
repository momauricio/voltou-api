import { MercadoPagoClient } from './mercadopago.client';

describe('MercadoPagoClient.createPayment', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('POSTs /v1/payments with application_fee (Voltou commission) and no collector_id', async () => {
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
      applicationFeeCents: 25,
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
    const body = JSON.parse(init.body) as Record<string, unknown>;
    expect(body.application_fee).toBe(0.25);
    expect(body).not.toHaveProperty('collector_id');
    expect(body.payment_method_id).toBe('pix');
    expect(body.transaction_amount).toBe(5);
  });

  it('still omits collector_id on card charges while sending application_fee', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          id: 22,
          status: 'approved',
          status_detail: 'accredited',
        }),
    });
    global.fetch = fetchMock;

    const client = new MercadoPagoClient();
    await client.createPayment('SELLER-OAUTH-TOKEN', {
      amountCents: 10000,
      description: 'Principal',
      paymentMethodId: 'master',
      payerEmail: 'teste.checkout@voltouapp.com',
      externalReference: 'chk-2',
      notificationUrl: 'https://api.example/mercadopago/webhook',
      applicationFeeCents: 500,
      token: 'card-token-abc',
      installments: 1,
      issuerId: '24',
      idempotencyKey: 'idem-2',
    });

    const body = JSON.parse(
      (fetchMock.mock.calls[0] as [string, { body: string }])[1].body,
    ) as Record<string, unknown>;
    expect(body.application_fee).toBe(5);
    expect(body).not.toHaveProperty('collector_id');
    expect(body.token).toBe('card-token-abc');
  });
});
