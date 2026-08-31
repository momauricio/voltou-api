export type PublicOfferPaymentFields = {
  paymentMode: 'transparent' | 'pro';
  mpPublicKey: string | null;
  canPay: boolean;
};

/**
 * Public offer payment metadata for the live /loja brick.
 * Transparent when the integrator public key is available; otherwise
 * keep Checkout Pro if a Preference init_point already exists.
 */
export function publicOfferPaymentFields(input: {
  status: string;
  mpConnected: boolean;
  mpPublicKey: string | null;
  providerInitPoint: string | null;
}): PublicOfferPaymentFields {
  const pending = input.status === 'pending';
  const mpPublicKey = input.mpPublicKey?.trim() || null;
  const paymentMode: 'transparent' | 'pro' =
    input.mpConnected && mpPublicKey ? 'transparent' : 'pro';
  const canPay =
    pending &&
    input.mpConnected &&
    (Boolean(mpPublicKey) || Boolean(input.providerInitPoint));

  return { paymentMode, mpPublicKey, canPay };
}
