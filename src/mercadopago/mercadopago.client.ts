import {
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  buildMpPaymentBody,
  mapMpPaymentToResult,
  mpPaymentErrorMessage,
  type MpPaymentApiResponse,
  type MpTransparentPaymentInput,
  type TransparentPaymentResult,
} from './mp-transparent-payment';

const AUTH_BASE = 'https://auth.mercadopago.com.br/authorization';
const API_BASE = 'https://api.mercadopago.com';

export type { TransparentPaymentResult };

export type MpCreatePaymentInput = MpTransparentPaymentInput & {
  idempotencyKey: string;
};

export type MpTokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user_id?: number;
  token_type?: string;
  scope?: string;
};

export type MpPreferenceResponse = {
  id: string;
  init_point: string;
  sandbox_init_point?: string;
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

  /** Integrator public key for Payment Brick (frontend). */
  getPublicKey(): string | null {
    return process.env.MP_PUBLIC_KEY?.trim() || null;
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
   * Checkout Transparente: POST /v1/payments with the seller OAuth token.
   * Never sends application_fee — MP rejects it on this auth mode.
   */
  async createPayment(
    accessToken: string,
    input: MpCreatePaymentInput,
  ): Promise<TransparentPaymentResult> {
    const body = buildMpPaymentBody(input);

    const res = await fetch(`${API_BASE}/v1/payments`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Idempotency-Key': input.idempotencyKey,
      },
      body: JSON.stringify(body),
    });

    const data = (await res.json().catch(() => ({}))) as MpPaymentApiResponse;
    if (!res.ok || data.id == null) {
      throw new Error(mpPaymentErrorMessage(data, res.status));
    }

    return mapMpPaymentToResult(data, input.amountCents);
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
