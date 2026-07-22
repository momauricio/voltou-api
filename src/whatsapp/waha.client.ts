import {
  BadGatewayException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';

export type WahaSessionStatus =
  | 'STOPPED'
  | 'STARTING'
  | 'SCAN_QR_CODE'
  | 'WORKING'
  | 'FAILED'
  | string;

export type WahaSession = {
  name: string;
  status: WahaSessionStatus;
  me?: { id?: string; pushName?: string } | null;
  engine?: { engine?: string };
};

export type WahaQrResponse = {
  mimetype: string;
  data: string;
};

@Injectable()
export class WahaClient {
  private readonly logger = new Logger(WahaClient.name);

  get configured(): boolean {
    return Boolean(process.env.WAHA_BASE_URL?.trim());
  }

  private get baseUrl(): string {
    const url = process.env.WAHA_BASE_URL?.trim().replace(/\/$/, '');
    if (!url) {
      throw new ServiceUnavailableException(
        'Conexão WhatsApp indisponível no momento. Tente novamente em breve.',
      );
    }
    return url;
  }

  private get apiKey(): string {
    return (
      process.env.WAHA_API_KEY?.trim() ||
      process.env.WHATSAPP_API_KEY?.trim() ||
      ''
    );
  }

  private async request<T>(
    path: string,
    init: RequestInit & { accept?: string } = {},
  ): Promise<T> {
    const headers: Record<string, string> = {
      Accept: init.accept ?? 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(this.apiKey ? { 'X-Api-Key': this.apiKey } : {}),
      ...(init.headers as Record<string, string> | undefined),
    };

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers,
      });
    } catch (err) {
      this.logger.error(`WAHA unreachable: ${String(err)}`);
      throw new ServiceUnavailableException(
        'Não foi possível conectar ao serviço de WhatsApp. Tente novamente em breve.',
      );
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      this.logger.warn(`WAHA ${init.method ?? 'GET'} ${path} → ${res.status}: ${text}`);
      throw new BadGatewayException(
        'O serviço de WhatsApp retornou um erro. Tente novamente em breve.',
      );
    }

    if (res.status === 204) {
      return undefined as T;
    }

    const contentType = res.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      return (await res.json()) as T;
    }

    return (await res.text()) as T;
  }

  createSession(
    name: string,
    config?: {
      webhooks?: Array<{ url: string; events: string[] }>;
    },
  ): Promise<WahaSession> {
    return this.request<WahaSession>('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({
        name,
        start: true,
        ...(config ? { config } : {}),
      }),
    });
  }

  updateSession(
    name: string,
    config: {
      webhooks?: Array<{ url: string; events: string[] }>;
    },
  ): Promise<WahaSession> {
    return this.request<WahaSession>(`/api/sessions/${encodeURIComponent(name)}`, {
      method: 'PUT',
      body: JSON.stringify({ config }),
    });
  }

  getSession(name: string): Promise<WahaSession> {
    return this.request<WahaSession>(`/api/sessions/${encodeURIComponent(name)}`);
  }

  listSessions(): Promise<WahaSession[]> {
    return this.request<WahaSession[]>('/api/sessions');
  }

  startSession(name: string): Promise<WahaSession> {
    return this.request<WahaSession>(
      `/api/sessions/${encodeURIComponent(name)}/start`,
      { method: 'POST' },
    );
  }

  stopSession(name: string): Promise<WahaSession> {
    return this.request<WahaSession>(
      `/api/sessions/${encodeURIComponent(name)}/stop`,
      { method: 'POST' },
    );
  }

  async logoutSession(name: string): Promise<void> {
    await this.request(`/api/sessions/${encodeURIComponent(name)}/logout`, {
      method: 'POST',
    });
  }

  async deleteSession(name: string): Promise<void> {
    await this.request(`/api/sessions/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    });
  }

  getQr(name: string): Promise<WahaQrResponse> {
    return this.request<WahaQrResponse>(
      `/api/${encodeURIComponent(name)}/auth/qr?format=image`,
      { accept: 'application/json' },
    );
  }

  sendText(params: {
    session: string;
    chatId: string;
    text: string;
  }): Promise<{ id?: string; messageId?: string }> {
    return this.request('/api/sendText', {
      method: 'POST',
      body: JSON.stringify({
        session: params.session,
        chatId: params.chatId,
        text: params.text,
      }),
    });
  }

  /** Resolve chatId real (incl. @lid em BR) antes de enviar. */
  checkExists(params: {
    session: string;
    phone: string;
  }): Promise<{ numberExists: boolean; chatId?: string }> {
    const phone = params.phone.replace(/\D/g, '');
    const q = new URLSearchParams({
      phone,
      session: params.session,
    });
    return this.request(`/api/contacts/check-exists?${q.toString()}`);
  }
}
