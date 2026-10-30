import { PrismaService } from '../prisma/prisma.service';
import { WahaClient } from './waha.client';
import type { WhatsAppProvider } from './whatsapp-provider.interface';
import { WhatsAppService } from './whatsapp.service';

describe('WhatsAppService session webhook config', () => {
  const keys = ['API_PUBLIC_URL', 'WHATSAPP_HOOK_HMAC_KEY', 'WAHA_WEBHOOK_SECRET'];
  const prev: Record<string, string | undefined> = {};
  let waha: { configured: boolean; updateSession: jest.Mock };
  let service: WhatsAppService;

  beforeEach(() => {
    for (const k of keys) {
      prev[k] = process.env[k];
      delete process.env[k];
    }
    process.env.API_PUBLIC_URL = 'https://api.example.test';
    waha = { configured: true, updateSession: jest.fn().mockResolvedValue({}) };
    const prisma = {
      whatsAppConnection: {
        findMany: jest.fn().mockResolvedValue([{ sessionName: 'voltou_a' }]),
      },
    };
    service = new WhatsAppService(
      {} as WhatsAppProvider,
      waha as unknown as WahaClient,
      prisma as unknown as PrismaService,
    );
  });

  afterEach(() => {
    for (const k of keys) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  });

  it('sends hmac.key to WAHA when WHATSAPP_HOOK_HMAC_KEY is set', async () => {
    process.env.WHATSAPP_HOOK_HMAC_KEY = ' hook-secret ';

    await expect(service.ensureSessionWebhook('voltou_a')).resolves.toEqual({
      ok: true,
      url: 'https://api.example.test/whatsapp/webhook',
    });
    const [name, config] = waha.updateSession.mock.calls[0];
    expect(name).toBe('voltou_a');
    expect(config.webhooks[0]).toEqual({
      url: 'https://api.example.test/whatsapp/webhook',
      events: ['message'],
      hmac: { key: 'hook-secret' },
    });
  });

  it('updates every session on boot (ensureAllSessionWebhooks) with hmac', async () => {
    process.env.WHATSAPP_HOOK_HMAC_KEY = 'hook-secret';

    await expect(service.ensureAllSessionWebhooks()).resolves.toEqual({ updated: 1 });
    expect(waha.updateSession.mock.calls[0][1].webhooks[0].hmac).toEqual({
      key: 'hook-secret',
    });
  });

  it('omits hmac when no secret is configured', async () => {
    await service.ensureSessionWebhook('voltou_a');
    const config = waha.updateSession.mock.calls[0][1];
    expect(config.webhooks[0]).not.toHaveProperty('hmac');
  });
});
