import {
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';

const AUTH_BASE = 'https://auth.mercadopago.com.br/authorization';
const API_BASE = 'https://api.mercadopago.com';

export type MpTokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user_id?: number;
  token_type?: string;
  scope?: string;
  public_key?: string;
};

export type MpPreferenceResponse = {
  id: string;
  init_point: string;
  sandbox_init_point?: string;
};

export type MpPaymentCreateInput = {
  transactionAmount: number;
  description: string;
  paymentMethodId: string;
  installments?: number;
  token?: string;
  issuerId?: string;
  payerEmail: string;
  payerIdentification?: { type: string; number: string };
  externalReference: string;
  applicationFee: number;
  notificationUrl: string;
  metadata?: Record<string, string>;
};

export type MpPaymentResponse = {
  id: number;
  status: string;
  status_detail?: string;
  external_reference?: string;
  transaction_amount?: number;
  point_of_interaction?: {
    transaction_data?: {
      qr_code?: string;
      qr_code_base64?: string;
      ticket_url?: string;
    };
  };
};

@Injectable()
export class MercadoPagoClient {
  isConfigured(): boolean {
    return Boolean(
      process.env.MP_CLIENT_ID?.trim() &&
        process.env.MP_CLIENT_SECRET?.trim() &&
        process.env.MP_REDIRECT_URI?.trim(),
    );
  }

  assertConfigured() {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException(
        'Mercado Pago não configurado — defina MP_CLIENT_ID, MP_CLIENT_SECRET e MP_REDIRECT_URI.',
      );
    }
  }

  buildAuthorizeUrl(state: string): string {
    this.assertConfigured();
    const params = new URLSearchParams({
      client_id: process.env.MP_CLIENT_ID!.trim(),
      response_type: 'code',
      platform_id: 'mp',
      state,
      redirect_uri: process.env.MP_REDIRECT_URI!.trim(),
    });
    return `${AUTH_BASE}?${params.toString()}`;
  }

  async exchangeCode(code: string): Promise<MpTokenResponse> {
    this.assertConfigured();
    return this.tokenRequest({
      grant_type: 'authorization_code',
      client_id: process.env.MP_CLIENT_ID!.trim(),
      client_secret: process.env.MP_CLIENT_SECRET!.trim(),
      code,
      redirect_uri: process.env.MP_REDIRECT_URI!.trim(),
    });
  }

  async refreshToken(refreshToken: string): Promise<MpTokenResponse> {
    this.assertConfigured();
    return this.tokenRequest({
      grant_type: 'refresh_token',
      client_id: process.env.MP_CLIENT_ID!.trim(),
      client_secret: process.env.MP_CLIENT_SECRET!.trim(),
      refresh_token: refreshToken,
    });
  }

  private async tokenRequest(
    body: Record<string, string>,
  ): Promise<MpTokenResponse> {
    const res = await fetch(`${API_BASE}/oauth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as MpTokenResponse & {
      message?: string;
      error?: string;
      error_description?: string;
    };
    if (!res.ok) {
      throw new Error(
        data.error_description ||
          data.message ||
          data.error ||
          `Falha OAuth Mercado Pago (HTTP ${res.status})`,
      );
    }
    if (!data.access_token || !data.refresh_token) {
      throw new Error('Resposta OAuth sem access_token/refresh_token.');
    }
    return data;
  }

  async createPreference(
    accessToken: string,
    input: {
      title: string;
      amountCents: number;
      marketplaceFeeCents: number;
      externalReference: string;
      notificationUrl: string;
      successUrl: string;
      pendingUrl: string;
      failureUrl: string;
      payerEmail?: string;
      items?: { id: string; title: string; amountCents: number }[];
    },
  ): Promise<MpPreferenceResponse> {
    const marketplaceFee = Number(
      (input.marketplaceFeeCents / 100).toFixed(2),
    );

    const items =
      input.items?.map((it) => ({
        id: it.id,
        title: it.title.slice(0, 256),
        quantity: 1,
        currency_id: 'BRL',
        unit_price: Number((it.amountCents / 100).toFixed(2)),
      })) ?? [
        {
          id: input.externalReference,
          title: input.title.slice(0, 256),
          quantity: 1,
          currency_id: 'BRL',
          unit_price: Number((input.amountCents / 100).toFixed(2)),
        },
      ];

    const body: Record<string, unknown> = {
      items,
      marketplace_fee: marketplaceFee,
      external_reference: input.externalReference,
      notification_url: input.notificationUrl,
      back_urls: {
        success: input.successUrl,
        pending: input.pendingUrl,
        failure: input.failureUrl,
      },
      auto_return: 'approved',
    };

    if (input.payerEmail) {
      body.payer = { email: input.payerEmail };
    }

    const res = await fetch(`${API_BASE}/checkout/preferences`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = (await res.json().catch(() => ({}))) as MpPreferenceResponse & {
      message?: string;
      error?: string;
    };

    if (!res.ok || !data.id || !data.init_point) {
      throw new Error(
        data.message ||
          data.error ||
          `Falha ao criar preferência MP (HTTP ${res.status})`,
      );
    }

    const useSandbox =
      process.env.MP_USE_SANDBOX === '1' || process.env.NODE_ENV !== 'production';

    return {
      id: data.id,
      init_point:
        useSandbox && data.sandbox_init_point
          ? data.sandbox_init_point
          : data.init_point,
      sandbox_init_point: data.sandbox_init_point,
    };
  }

  /**
   * Tenta obter a public_key do vendedor (necessária para Bricks).
   * OAuth às vezes já devolve; senão consultamos endpoints auxiliares.
   */
  async resolvePublicKey(
    accessToken: string,
    fromOauth?: string | null,
  ): Promise<string | null> {
    if (fromOauth?.trim()) return fromOauth.trim();

    const attempts: Array<() => Promise<string | null>> = [
      async () => {
        const res = await fetch(`${API_BASE}/v1/plugins/configurations`, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json',
          },
        });
        if (!res.ok) return null;
        const data = (await res.json().catch(() => null)) as
          | { public_key?: string }
          | Array<{ public_key?: string }>
          | null;
        if (Array.isArray(data)) {
          return data.find((x) => x.public_key)?.public_key?.trim() ?? null;
        }
        return data?.public_key?.trim() ?? null;
      },
      async () => {
        const res = await fetch(`${API_BASE}/users/me`, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: 'application/json',
          },
        });
        if (!res.ok) return null;
        const data = (await res.json().catch(() => null)) as {
          public_key?: string;
        } | null;
        return data?.public_key?.trim() ?? null;
      },
    ];

    for (const attempt of attempts) {
      try {
        const key = await attempt();
        if (key) return key;
      } catch {
        /* try next */
      }
    }
    return null;
  }

  async createPayment(
    accessToken: string,
    input: MpPaymentCreateInput,
    idempotencyKey: string,
  ): Promise<MpPaymentResponse> {
    const body: Record<string, unknown> = {
      transaction_amount: Number(input.transactionAmount.toFixed(2)),
      description: input.description.slice(0, 255),
      payment_method_id: input.paymentMethodId,
      installments: input.installments ?? 1,
      payer: {
        email: input.payerEmail,
      },
      external_reference: input.externalReference,
application_fee: Number(input.applicationFee.toFixed(2)),
      notification_url: input.notificationUrl,
      metadata: input.metadata ?? {},
    };

    if (input.token) {
      body.token = input.token;
    }
    if (input.issuerId) {
      body.issuer_id = input.issuerId;
    }
    if (input.payerIdentification) {
      (body.payer as Record<string, unknown>).identification =
        input.payerIdentification;
    }

    const res = await fetch(`${API_BASE}/v1/payments`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Idempotency-Key': idempotencyKey,
      },
      body: JSON.stringify(body),
    });

    const data = (await res.json().catch(() => ({}))) as MpPaymentResponse & {
      message?: string;
      error?: string;
      cause?: Array<{ description?: string; code?: string }>;
    };

    if (!res.ok || !data.id) {
      const cause = data.cause?.[0]?.description;
      throw new Error(
        cause ||
          data.message ||
          data.error ||
          `Falha ao criar pagamento MP (HTTP ${res.status})`,
      );
    }

    return data;
  }

  async getPayment(accessToken: string, paymentId: string) {
    const res = await fetch(`${API_BASE}/v1/payments/${paymentId}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    });
    const data = (await res.json().catch(() => ({}))) as {
      id?: number;
      status?: string;
      external_reference?: string;
      transaction_amount?: number;
      message?: string;
    };
    if (!res.ok) {
      throw new Error(
        data.message || `Falha ao buscar pagamento MP (HTTP ${res.status})`,
      );
    }
    return data;
  }
}
