import {
  buildMpPaymentBody,
  mapMpPaymentToResult,
  sellerTokenPaymentIdempotencyKey,
} from './mp-transparent-payment';

const pixInput = {
  amountCents: 500,
  description: 'Oferta teste',
  paymentMethodId: 'pix',
  payerEmail: 'teste.checkout@voltouapp.com',
  externalReference: 'checkout-1',
  notificationUrl: 'https://api.voltouapp.com/mercadopago/webhook',
};

describe('buildMpPaymentBody', () => {
  it('omits application_fee on seller-token Pix charges even when commission exists', () => {
    const body = buildMpPaymentBody(pixInput);

    expect(body.application_fee).toBeUndefined();
    expect(body).not.toHaveProperty('application_fee');
    expect(body.collector_id).toBeUndefined();
    expect(body).not.toHaveProperty('collector_id');
    expect(body.payment_method_id).toBe('pix');
    expect(body.transaction_amount).toBe(5);
    expect(body.payer).toEqual({ email: 'teste.checkout@voltouapp.com' });
    expect(body.external_reference).toBe('checkout-1');
  });

  it('omits application_fee on seller-token card charges', () => {
    const body = buildMpPaymentBody({
      ...pixInput,
      paymentMethodId: 'master',
      token: 'card-token-abc',
      installments: 1,
      issuerId: '24',
      payerIdentification: { type: 'CPF', number: '19119119100' },
    });

    expect(body).not.toHaveProperty('application_fee');
    expect(body).not.toHaveProperty('collector_id');
    expect(body.token).toBe('card-token-abc');
    expect(body.installments).toBe(1);
    expect(body.issuer_id).toBe('24');
    expect(body.payer).toEqual({
      email: 'teste.checkout@voltouapp.com',
      identification: { type: 'CPF', number: '19119119100' },
    });
  });

  it('does not send installments for Pix', () => {
    const body = buildMpPaymentBody({
      ...pixInput,
      installments: 1,
    });
    expect(body.installments).toBeUndefined();
    expect(body.token).toBeUndefined();
  });
});

describe('mapMpPaymentToResult', () => {
  it('maps Pix pending payload for Payment Brick', () => {
    const result = mapMpPaymentToResult(
      {
        id: 5466310457,
        status: 'pending',
        status_detail: 'pending_waiting_transfer',
        point_of_interaction: {
          transaction_data: {
            qr_code: '0002012660',
            qr_code_base64: 'iVBORw0KGgo',
            ticket_url: 'https://www.mercadopago.com.br/payments/1/ticket',
          },
        },
      },
      500,
    );

    expect(result).toEqual({
      paymentId: 5466310457,
      status: 'pending',
      statusDetail: 'pending_waiting_transfer',
      amountCents: 500,
      pixQrCode: '0002012660',
      pixQrCodeBase64: 'iVBORw0KGgo',
      pixTicketUrl: 'https://www.mercadopago.com.br/payments/1/ticket',
    });
  });

  it('maps approved card payload without Pix fields', () => {
    const result = mapMpPaymentToResult(
      { id: 99, status: 'approved', status_detail: 'accredited' },
      500,
    );
    expect(result.status).toBe('approved');
    expect(result.pixQrCode).toBeNull();
    expect(result.pixQrCodeBase64).toBeNull();
    expect(result.pixTicketUrl).toBeNull();
  });
});

describe('sellerTokenPaymentIdempotencyKey', () => {
  it('is stable for the same Pix intent', () => {
    const a = sellerTokenPaymentIdempotencyKey({
      checkoutId: 'chk-1',
      paymentMethodId: 'pix',
      amountCents: 500,
    });
    const b = sellerTokenPaymentIdempotencyKey({
      checkoutId: 'chk-1',
      paymentMethodId: 'PIX',
      amountCents: 500,
    });
    expect(a).toBe('chk-1:pix:500:no-token');
    expect(b).toBe(a);
  });
});
