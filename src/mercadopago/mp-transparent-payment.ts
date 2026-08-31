/**
 * Checkout Transparente (Payments API) body for a seller OAuth token.
 *
 * Mercado Pago rejects `application_fee` on this auth mode with
 * "You cannot use application_fee with this payment." (often Pix).
 * Commission is recorded in our database, not collected via MP split
 * on this path. Checkout Pro Preferences still use marketplace_fee.
 */
export type MpTransparentPaymentInput = {
  amountCents: number;
  description: string;
  paymentMethodId: string;
  payerEmail: string;
  externalReference: string;
  notificationUrl: string;
  commissionCents?: number;
  token?: string;
  installments?: number;
  issuerId?: string;
  payerIdentification?: { type: string; number: string };
};

export type MpPaymentApiResponse = {
  id?: number | string;
  status?: string;
  status_detail?: string;
  point_of_interaction?: {
    transaction_data?: {
      qr_code?: string;
      qr_code_base64?: string;
      ticket_url?: string;
    };
  };
  message?: string;
  error?: string;
  cause?: { description?: string; code?: string }[];
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

export function buildMpPaymentBody(
  input: MpTransparentPaymentInput,
): Record<string, unknown> {
  const method = input.paymentMethodId.trim().toLowerCase();
  const payer: Record<string, unknown> = { email: input.payerEmail.trim() };
  if (input.payerIdentification?.type && input.payerIdentification?.number) {
    payer.identification = {
      type: input.payerIdentification.type,
      number: input.payerIdentification.number,
    };
  }

  const body: Record<string, unknown> = {
    transaction_amount: Number((input.amountCents / 100).toFixed(2)),
    description: input.description.slice(0, 256),
    payment_method_id: method,
    payer,
    external_reference: input.externalReference,
    notification_url: input.notificationUrl,
  };

  const isPix = method === 'pix';
  if (!isPix && input.token) {
    body.token = input.token;
    body.installments =
      input.installments && input.installments > 0 ? input.installments : 1;
    if (input.issuerId) {
      body.issuer_id = input.issuerId;
    }
  }

  return body;
}

export function mapMpPaymentToResult(
  data: MpPaymentApiResponse,
  amountCents: number,
): TransparentPaymentResult {
  const td = data.point_of_interaction?.transaction_data;
  return {
    paymentId: Number(data.id),
    status: String(data.status ?? ''),
    statusDetail: data.status_detail ?? null,
    amountCents,
    pixQrCode: td?.qr_code ?? null,
    pixQrCodeBase64: td?.qr_code_base64 ?? null,
    pixTicketUrl: td?.ticket_url ?? null,
  };
}

export function mpPaymentErrorMessage(
  data: MpPaymentApiResponse,
  status: number,
) {
  const cause = data.cause?.find((c) => c.description)?.description;
  return (
    cause ||
    data.message ||
    data.error ||
    `Falha ao criar pagamento MP (HTTP ${status})`
  );
}
