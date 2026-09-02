function calcCheckDigit(digits: string, weights: number[]): number {
  const sum = digits
    .split('')
    .reduce((acc, d, i) => acc + Number(d) * weights[i], 0);
  const mod = sum % 11;
  return mod < 2 ? 0 : 11 - mod;
}

export function isValidCnpj(cnpj: string): boolean {
  const digits = cnpj.replace(/\D/g, '');
  if (digits.length !== 14) return false;
  if (/^(\d)\1+$/.test(digits)) return false;

  const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const w2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const d1 = calcCheckDigit(digits.slice(0, 12), w1);
  const d2 = calcCheckDigit(digits.slice(0, 12) + String(d1), w2);
  return digits.endsWith(`${d1}${d2}`);
}

type BrasilApiCnpj = {
  cnpj?: string;
  razao_social?: string;
  descricao_situacao_cadastral?: string;
  situacao_cadastral?: string | number;
};

export type CnpjStatus = { ok: boolean; active: boolean };

function isActiveSituation(data: BrasilApiCnpj): boolean {
  const situation = String(
    data.descricao_situacao_cadastral ?? data.situacao_cadastral ?? '',
  )
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();

  return (
    situation.includes('ATIVA') ||
    situation === '2' ||
    situation === 'ATIVA'
  );
}

async function fetchBrasilApiCnpj(
  digits: string,
): Promise<{ found: false } | { found: true; active: boolean }> {
  const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${digits}`, {
    headers: { Accept: 'application/json' },
  });

  if (res.status === 404) {
    return { found: false };
  }
  if (!res.ok) {
    throw new Error('Não foi possível validar o CNPJ agora. Tente novamente.');
  }

  const data = (await res.json()) as BrasilApiCnpj;
  return { found: true, active: isActiveSituation(data) };
}

/** Public lookup: never returns the full Receita payload. */
export async function getCnpjStatus(cnpj: string): Promise<CnpjStatus> {
  const digits = cnpj.replace(/\D/g, '');
  if (!isValidCnpj(digits)) {
    return { ok: false, active: false };
  }

  const record = await fetchBrasilApiCnpj(digits);
  if (!record.found) {
    return { ok: false, active: false };
  }
  return { ok: true, active: record.active };
}

/** Validates check digits and confirms CNPJ is active via BrasilAPI. */
export async function assertActiveCnpj(cnpj: string): Promise<void> {
  if (!isValidCnpj(cnpj)) {
    throw new Error('CNPJ inválido.');
  }

  const digits = cnpj.replace(/\D/g, '');
  const record = await fetchBrasilApiCnpj(digits);

  if (!record.found) {
    throw new Error('CNPJ não encontrado na Receita Federal.');
  }
  if (!record.active) {
    throw new Error('CNPJ precisa estar ativo na Receita Federal.');
  }
}
