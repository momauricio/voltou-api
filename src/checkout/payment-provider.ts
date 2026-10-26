export type PaymentProviderId = 'mercadopago' | 'infinitepay' | 'stub';

export type CreatePaymentLinkInput = {
  tenantId: string;
  storeId: string;
  checkoutId: string;
  publicToken: string;
  /** Friendly store offer URL pieces for MP back_urls */
  storeSlug?: string;
  couponCode?: string;
  amountCents: number;
  title: string;
  commissionCents: number;
  payerEmail?: string;
  /** When present, MP Preference uses these instead of single title/amount */
  items?: { id: string; title: string; amountCents: number }[];
};

export type CreatePaymentLinkResult = {
  initPoint: string;
  providerRef: string;
};

/**
 * Adapter de PSP. Mercado Pago é o MVP; InfinitePay e outros
 * implementam a mesma interface depois.
 */
export interface PaymentProvider {
  readonly id: PaymentProviderId;

  isConnected(tenantId: string, storeId: string): Promise<boolean>;

  createPaymentLink(
    input: CreatePaymentLinkInput,
  ): Promise<CreatePaymentLinkResult>;
}

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');
