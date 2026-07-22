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

/** Validates check digits and confirms CNPJ is active via BrasilAPI. */
export async function assertActiveCnpj(cnpj: string): Promise<void> {
  if (!isValidCnpj(cnpj)) {
    throw new Error('CNPJ inválido.');
  }

  const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, {
    headers: { Accept: 'application/json' },
  });

  if (res.status === 404) {
    throw new Error('CNPJ não encontrado na Receita Federal.');
  }
  if (!res.ok) {
    throw new Error('Não foi possível validar o CNPJ agora. Tente novamente.');
  }

  const data = (await res.json()) as BrasilApiCnpj;
  const situation = String(
    data.descricao_situacao_cadastral ?? data.situacao_cadastral ?? '',
  )
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();

  const active =
    situation.includes('ATIVA') ||
    situation === '2' ||
    situation === 'ATIVA';

  if (!active) {
    throw new Error('CNPJ precisa estar ativo na Receita Federal.');
  }
}
