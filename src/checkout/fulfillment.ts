export type ShippingAddress = {
  recipientName: string;
  phoneE164: string;
  cep: string;
  street: string;
  number: string;
  complement?: string;
  neighborhood: string;
  city: string;
  state: string;
};

export type FulfillmentMethod = 'pickup' | 'delivery';
export type FulfillmentStatus = 'awaiting' | 'ready' | 'shipped' | 'done';

export function resolveShippingCents(
  method: FulfillmentMethod,
  storeShippingCents: number,
): number {
  if (method === 'pickup') return 0;
  return Math.max(0, Math.floor(storeShippingCents));
}

export function computePaymentAmounts(
  productsCents: number,
  shippingCents: number,
  commissionRateBps: number,
): { chargeCents: number; commissionCents: number } {
  const products = Math.max(0, Math.floor(productsCents));
  const shipping = Math.max(0, Math.floor(shippingCents));
  return {
    chargeCents: products + shipping,
    commissionCents: Math.round((products * commissionRateBps) / 10000),
  };
}

function reqStr(v: unknown, label: string): string {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) throw new Error(`Informe ${label}.`);
  return s;
}

export function parseShippingAddress(raw: unknown): ShippingAddress {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Endereço de entrega obrigatório.');
  }
  const o = raw as Record<string, unknown>;
  const cepDigits = String(o.cep ?? '').replace(/\D/g, '');
  if (cepDigits.length !== 8) throw new Error('CEP inválido.');
  const state = reqStr(o.state, 'UF').toUpperCase();
  if (!/^[A-Z]{2}$/.test(state)) throw new Error('UF inválida.');
  const phoneRaw = reqStr(o.phoneE164 ?? o.phone, 'telefone');
  const phoneDigits = phoneRaw.replace(/\D/g, '');
  const phoneE164 =
    phoneDigits.startsWith('55') && phoneDigits.length >= 12
      ? `+${phoneDigits}`
      : phoneDigits.length >= 10
        ? `+55${phoneDigits}`
        : phoneRaw.startsWith('+')
          ? `+${phoneDigits}`
          : `+${phoneDigits}`;
  if (phoneDigits.replace(/^55/, '').length < 10) {
    throw new Error('Telefone inválido.');
  }
  const complement =
    typeof o.complement === 'string' && o.complement.trim()
      ? o.complement.trim()
      : undefined;
  return {
    recipientName: reqStr(o.recipientName, 'nome do destinatário'),
    phoneE164,
    cep: cepDigits,
    street: reqStr(o.street, 'rua'),
    number: reqStr(o.number, 'número'),
    complement,
    neighborhood: reqStr(o.neighborhood, 'bairro'),
    city: reqStr(o.city, 'cidade'),
    state,
  };
}

export function serializeShippingAddress(a: ShippingAddress): string {
  return JSON.stringify(a);
}

const ALLOWED: Record<FulfillmentMethod, Partial<Record<FulfillmentStatus, FulfillmentStatus[]>>> = {
  pickup: {
    awaiting: ['ready', 'done'],
    ready: ['done'],
  },
  delivery: {
    awaiting: ['shipped', 'done'],
    shipped: ['done'],
  },
};

export function assertFulfillmentTransition(
  method: FulfillmentMethod,
  from: string,
  to: string,
): void {
  const next = ALLOWED[method]?.[from as FulfillmentStatus];
  if (!next || !next.includes(to as FulfillmentStatus)) {
    throw new Error(`Transição inválida: ${from} → ${to} (${method}).`);
  }
}
