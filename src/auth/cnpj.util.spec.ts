import { assertActiveCnpj, getCnpjStatus } from './cnpj.util';

const ACTIVE_CNPJ = '11222333000181';

describe('getCnpjStatus', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('returns { ok, active } without dumping the Receita payload', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        cnpj: ACTIVE_CNPJ,
        razao_social: 'EMPRESA TESTE LTDA',
        descricao_situacao_cadastral: 'ATIVA',
        qsa: [{ nome: 'socio secreto' }],
      }),
    }) as unknown as typeof fetch;

    const status = await getCnpjStatus(ACTIVE_CNPJ);
    expect(status).toEqual({ ok: true, active: true });
    expect(Object.keys(status).sort()).toEqual(['active', 'ok']);
  });

  it('marks inactive CNPJ as ok lookup but not active', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        descricao_situacao_cadastral: 'BAIXADA',
      }),
    }) as unknown as typeof fetch;

    await expect(getCnpjStatus(ACTIVE_CNPJ)).resolves.toEqual({
      ok: true,
      active: false,
    });
  });

  it('returns ok:false for invalid check digits without calling BrasilAPI', async () => {
    global.fetch = jest.fn();
    await expect(getCnpjStatus('00000000000000')).resolves.toEqual({
      ok: false,
      active: false,
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe('assertActiveCnpj', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('rejects inactive CNPJ', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ descricao_situacao_cadastral: 'SUSPENSA' }),
    }) as unknown as typeof fetch;

    await expect(assertActiveCnpj(ACTIVE_CNPJ)).rejects.toThrow(
      /ativo na Receita/i,
    );
  });

  it('rejects INATIVA (does not treat it as ATIVA via substring)', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ descricao_situacao_cadastral: 'INATIVA' }),
    }) as unknown as typeof fetch;

    await expect(getCnpjStatus(ACTIVE_CNPJ)).resolves.toEqual({
      ok: true,
      active: false,
    });
    await expect(assertActiveCnpj(ACTIVE_CNPJ)).rejects.toThrow(
      /ativo na Receita/i,
    );
  });
});
