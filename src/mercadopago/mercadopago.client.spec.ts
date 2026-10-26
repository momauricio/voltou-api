import { MercadoPagoClient } from './mercadopago.client';

function okFetch(data: unknown) {
  return jest.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(data),
  });
}

describe('MercadoPagoClient.createPayment', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('POSTs /v1/payments with application_fee, metadata, installments and no collector_id (Pix)', async () => {
    const fetchMock = okFetch({
      id: 11,
      status: 'pending',
      status_detail: 'pending_waiting_transfer',
      point_of_interaction: { transaction_data: { qr_code: 'pix-copy' } },
    });
    global.fetch = fetchMock;

    const client = new MercadoPagoClient();
    const payment = await client.createPayment(
      'SELLER-OAUTH-TOKEN',
      {
        transactionAmount: 5,
        description: 'Principal + Meia',
        paymentMethodId: 'pix',
        payerEmail: 'teste.checkout@voltouapp.com',
        externalReference: 'chk-1',
        notificationUrl: 'https://api.example/mercadopago/webhook',
        applicationFee: 0.25,
        metadata: { checkout_id: 'chk-1', source: 'voltou_transparent' },
      },
      'idem-1',
    );

    expect(payment.id).toBe(11);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [
      string,
      { method: string; headers: Record<string, string>; body: string },
    ];
    expect(url).toBe('https://api.mercadopago.com/v1/payments');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer SELLER-OAUTH-TOKEN');
    expect(init.headers['X-Idempotency-Key']).toBe('idem-1');
    expect(JSON.parse(init.body)).toEqual({
      transaction_amount: 5,
      description: 'Principal + Meia',
      payment_method_id: 'pix',
      installments: 1,
      payer: { email: 'teste.checkout@voltouapp.com' },
      external_reference: 'chk-1',
      application_fee: 0.25,
      notification_url: 'https://api.example/mercadopago/webhook',
      metadata: { checkout_id: 'chk-1', source: 'voltou_transparent' },
    });
  });

  it('sends token/issuer/identification on card charges and truncates description to 255', async () => {
    const fetchMock = okFetch({ id: 22, status: 'approved' });
    global.fetch = fetchMock;

    const client = new MercadoPagoClient();
    await client.createPayment(
      'SELLER-OAUTH-TOKEN',
      {
        transactionAmount: 100,
        description: 'x'.repeat(300),
        paymentMethodId: 'master',
        payerEmail: 'teste.checkout@voltouapp.com',
        payerIdentification: { type: 'CPF', number: '12345678909' },
        externalReference: 'chk-2',
        notificationUrl: 'https://api.example/mercadopago/webhook',
        applicationFee: 5,
        token: 'card-token-abc',
        installments: 3,
        issuerId: '24',
      },
      'idem-2',
    );

    const body = JSON.parse(
      (fetchMock.mock.calls[0] as [string, { body: string }])[1].body,
    ) as Record<string, unknown>;
    expect(body.application_fee).toBe(5);
    expect(body).not.toHaveProperty('collector_id');
    expect(body.token).toBe('card-token-abc');
    expect(body.installments).toBe(3);
    expect(body.issuer_id).toBe('24');
    expect(body.payer).toEqual({
      email: 'teste.checkout@voltouapp.com',
      identification: { type: 'CPF', number: '12345678909' },
    });
    expect((body.description as string).length).toBe(255);
    expect(body.metadata).toEqual({});
  });

  it('throws the first MP cause description on failure', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: () =>
        Promise.resolve({ message: 'bad', cause: [{ description: 'Invalid card' }] }),
    });
    const client = new MercadoPagoClient();
    await expect(
      client.createPayment(
        'T',
        {
          transactionAmount: 1,
          description: 'd',
          paymentMethodId: 'visa',
          payerEmail: 'a@b.c',
          externalReference: 'chk',
          notificationUrl: 'n',
          applicationFee: 0,
        },
        'k',
      ),
    ).rejects.toThrow('Invalid card');
  });
});

describe('MercadoPagoClient.resolvePublicKey', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('returns the OAuth public_key without calling MP', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock;
    const client = new MercadoPagoClient();
    expect(await client.resolvePublicKey('T', ' APP_USR-oauth ')).toBe(
      'APP_USR-oauth',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('uses /v1/plugins/configurations then /users/me', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({ ok: false, json: () => Promise.resolve({}) })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ public_key: 'APP_USR-me' }),
      });
    global.fetch = fetchMock;
    const client = new MercadoPagoClient();
    expect(await client.resolvePublicKey('T')).toBe('APP_USR-me');
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
      'https://api.mercadopago.com/v1/plugins/configurations',
      'https://api.mercadopago.com/users/me',
    ]);
  });

  it('reads public_key from an array plugins response', async () => {
    global.fetch = okFetch([{}, { public_key: 'APP_USR-plugin' }]);
    const client = new MercadoPagoClient();
    expect(await client.resolvePublicKey('T')).toBe('APP_USR-plugin');
  });

  it('returns null when nothing works', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network'));
    const client = new MercadoPagoClient();
    expect(await client.resolvePublicKey('T')).toBeNull();
  });
});
