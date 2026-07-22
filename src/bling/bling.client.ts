import { Injectable, ServiceUnavailableException } from '@nestjs/common';

const OAUTH_BASE = 'https://www.bling.com.br/Api/v3/oauth';
const API_BASE = 'https://api.bling.com.br/Api/v3';

export type BlingTokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type?: string;
};

export type BlingProduct = {
  id: number;
  nome: string;
  codigo?: string | null;
  preco?: number | null;
  situacao?: string | null;
};

export type BlingStockBalance = {
  produto?: { id?: number };
  saldoVirtualTotal?: number;
  saldoFisicoTotal?: number;
};

@Injectable()
export class BlingClient {
  isConfigured(): boolean {
    return Boolean(
      process.env.BLING_CLIENT_ID?.trim() &&
        process.env.BLING_CLIENT_SECRET?.trim() &&
        process.env.BLING_REDIRECT_URI?.trim(),
    );
  }

  assertConfigured() {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException(
        'Bling não configurado — cadastre o app no portal do desenvolvedor e defina BLING_CLIENT_ID, BLING_CLIENT_SECRET e BLING_REDIRECT_URI.',
      );
    }
  }

  private basicAuthHeader(): string {
    const id = process.env.BLING_CLIENT_ID!.trim();
    const secret = process.env.BLING_CLIENT_SECRET!.trim();
    return `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`;
  }

  buildAuthorizeUrl(state: string): string {
    this.assertConfigured();
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: process.env.BLING_CLIENT_ID!.trim(),
      state,
      redirect_uri: process.env.BLING_REDIRECT_URI!.trim(),
    });
    return `${OAUTH_BASE}/authorize?${params.toString()}`;
  }

  async exchangeCode(code: string): Promise<BlingTokenResponse> {
    this.assertConfigured();
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: process.env.BLING_REDIRECT_URI!.trim(),
    });
    return this.tokenRequest(body);
  }

  async refreshToken(refreshToken: string): Promise<BlingTokenResponse> {
    this.assertConfigured();
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });
    return this.tokenRequest(body);
  }

  private async tokenRequest(body: URLSearchParams): Promise<BlingTokenResponse> {
    const res = await fetch(`${OAUTH_BASE}/token`, {
      method: 'POST',
      headers: {
        Authorization: this.basicAuthHeader(),
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        'enable-jwt': '1',
      },
      body,
    });
    const data = (await res.json().catch(() => ({}))) as BlingTokenResponse & {
      error?: string;
      error_description?: string;
      message?: string;
    };
    if (!res.ok) {
      throw new Error(
        data.error_description ||
          data.message ||
          data.error ||
          `Falha OAuth Bling (HTTP ${res.status})`,
      );
    }
    if (!data.access_token || !data.refresh_token) {
      throw new Error('Resposta OAuth do Bling sem access_token/refresh_token.');
    }
    return data;
  }

  async listProducts(accessToken: string): Promise<BlingProduct[]> {
    const all: BlingProduct[] = [];
    let pagina = 1;
    const limite = 100;

    for (;;) {
      const url = new URL(`${API_BASE}/produtos`);
      url.searchParams.set('pagina', String(pagina));
      url.searchParams.set('limite', String(limite));

      const res = await this.apiGet(accessToken, url.toString());
      const payload = (await res.json()) as {
        data?: BlingProduct[];
        error?: { message?: string };
      };

      if (!res.ok) {
        throw new Error(
          payload.error?.message || `Erro ao listar produtos Bling (HTTP ${res.status})`,
        );
      }

      const page = payload.data ?? [];
      all.push(...page);
      if (page.length < limite) break;
      pagina += 1;
      if (pagina > 50) break; // safety cap
    }

    return all;
  }

  async getStockBalances(
    accessToken: string,
    productIds: number[],
  ): Promise<Map<number, number>> {
    const balances = new Map<number, number>();
    const chunkSize = 50;

    for (let i = 0; i < productIds.length; i += chunkSize) {
      const chunk = productIds.slice(i, i + chunkSize);
      const url = new URL(`${API_BASE}/estoques/saldos`);
      for (const id of chunk) {
        url.searchParams.append('idsProdutos[]', String(id));
      }

      const res = await this.apiGet(accessToken, url.toString());
      const payload = (await res.json()) as {
        data?: BlingStockBalance[];
        error?: { message?: string };
      };

      if (!res.ok) {
        throw new Error(
          payload.error?.message || `Erro ao buscar estoques Bling (HTTP ${res.status})`,
        );
      }

      for (const row of payload.data ?? []) {
        const id = row.produto?.id;
        if (id == null) continue;
        const stock = Math.max(
          0,
          Math.round(row.saldoVirtualTotal ?? row.saldoFisicoTotal ?? 0),
        );
        balances.set(id, stock);
      }
    }

    return balances;
  }

  private apiGet(accessToken: string, url: string) {
    return fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        'enable-jwt': '1',
      },
    });
  }
}
