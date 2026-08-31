import { publicOfferPaymentFields } from './public-offer-payment';

describe('publicOfferPaymentFields', () => {
  it('exposes transparent mode and canPay when MP is connected and public key exists', () => {
    expect(
      publicOfferPaymentFields({
        status: 'pending',
        mpConnected: true,
        mpPublicKey: 'APP_USR-public-key',
        providerInitPoint: null,
      }),
    ).toEqual({
      paymentMode: 'transparent',
      mpPublicKey: 'APP_USR-public-key',
      canPay: true,
    });
  });

  it('keeps Checkout Pro metadata when there is no public key but a Preference exists', () => {
    expect(
      publicOfferPaymentFields({
        status: 'pending',
        mpConnected: true,
        mpPublicKey: null,
        providerInitPoint:
          'https://www.mercadopago.com.br/checkout/v1/redirect?pref_id=abc',
      }),
    ).toEqual({
      paymentMode: 'pro',
      mpPublicKey: null,
      canPay: true,
    });
  });

  it('disables pay when MP is disconnected', () => {
    expect(
      publicOfferPaymentFields({
        status: 'pending',
        mpConnected: false,
        mpPublicKey: 'APP_USR-public-key',
        providerInitPoint: 'https://mp.example/pref',
      }),
    ).toMatchObject({ canPay: false });
  });

  it('disables pay when checkout is no longer pending', () => {
    expect(
      publicOfferPaymentFields({
        status: 'paid',
        mpConnected: true,
        mpPublicKey: 'APP_USR-public-key',
        providerInitPoint: null,
      }),
    ).toMatchObject({ canPay: false, paymentMode: 'transparent' });
  });
});
