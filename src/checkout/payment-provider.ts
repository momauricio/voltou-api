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

export type CreateTransparentPaymentInput = {
  tenantId: string;
  storeId: string;
  checkoutId: string;
  amountCents: number;
  commissionCents: number;
  title: string;
  paymentMethodId: string;
  payerEmail: string;
  token?: string;
  installments?: number;
  issuerId?: string;
  payerIdentification?: { type: string; number: string };
};

export type TransparentPaymentResult = {
  paymentId: number;
  status: string;
  statusDetail: string | null;
  amountCents: number;
  pixQrCode: string | null;
  pixQrCodeBase64: string | null;
  pixTicketUrl: string | null;
};

/**
 * Adapter de PSP. Mercado Pago é o MVP; InfinitePay e outros
 * implementam a mesma interface depois.
 */
export interface PaymentProvider {
  readonly id: PaymentProviderId;

  isConnected(tenantId: string, storeId: string): Promise<boolean>;

  /** Integrator MP_PUBLIC_KEY wins over a seller key. */
  getSellerPublicKey(sellerPublicKey?: string | null): string | null;

  createPaymentLink(
    input: CreatePaymentLinkInput,
  ): Promise<CreatePaymentLinkResult>;

  createTransparentPayment(
    input: CreateTransparentPaymentInput,
  ): Promise<TransparentPaymentResult>;
}

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');
