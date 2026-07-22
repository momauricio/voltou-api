import { normalizeHeader } from './csv.util';
import { parseDateBr, parseMoneyToCents } from './import.types';

export type SheetKind = 'customers' | 'products' | 'sales' | 'ambiguous';

export type Field =
  | 'cliente'
  | 'telefone'
  | 'cpf'
  | 'email'
  | 'produto'
  | 'sku'
  | 'categoria'
  | 'preco'
  | 'custo'
  | 'estoque'
  | 'quantidade'
  | 'valor_total'
  | 'data';

export const ALL_FIELDS: Field[] = [
  'cliente',
  'telefone',
  'cpf',
  'email',
  'produto',
  'sku',
  'categoria',
  'preco',
  'custo',
  'estoque',
  'quantidade',
  'valor_total',
  'data',
];

/** Aliases BR — `nome`/`name` NÃO entram em cliente (ambíguo com produto). */
export const HEADER_ALIASES: Record<Field, string[]> = {
  cliente: [
    'cliente',
    'nome_cliente',
    'consumidor',
    'comprador',
    'customer',
    'razao_social',
    'nome_completo',
    'destinatario',
  ],
  telefone: [
    'telefone',
    'celular',
    'whatsapp',
    'fone',
    'tel',
    'phone',
    'contato',
    'telefone_cliente',
    'numero',
    'fone_cliente',
  ],
  cpf: [
    'cpf',
    'cpf_cnpj',
    'documento',
    'doc',
    'cnpj_cpf',
    'cnpj',
    'doc_cliente',
  ],
  email: ['email', 'e_mail', 'mail', 'correo'],
  produto: [
    'produto',
    'item',
    'descricao',
    'descricao_produto',
    'desc',
    'mercadoria',
    'product',
    'nome_produto',
    'titulo',
    'produto_servico',
  ],
  sku: [
    'sku',
    'codigo',
    'cod',
    'cod_produto',
    'codigo_produto',
    'ref',
    'referencia',
    'ean',
    'codigo_barras',
    'gtin',
  ],
  categoria: [
    'categoria',
    'category',
    'grupo',
    'secao',
    'departamento',
    'linha',
    'tipo',
  ],
  preco: [
    'preco',
    'preco_unitario',
    'valor_unitario',
    'vl_unitario',
    'vl_unit',
    'unitario',
    'price',
    'preco_venda',
  ],
  custo: ['custo', 'preco_custo', 'custo_unitario', 'vl_custo', 'cost'],
  estoque: [
    'estoque',
    'saldo',
    'qtd_estoque',
    'quantidade_estoque',
    'stock',
    'disponivel',
  ],
  quantidade: [
    'quantidade',
    'qtd',
    'qtde',
    'qty',
    'quant',
    'qtd_vendida',
  ],
  valor_total: [
    'valor_total',
    'vl_total',
    'total',
    'total_venda',
    'valor_venda',
    'subtotal',
    'total_item',
    'valor',
  ],
  data: [
    'data',
    'data_venda',
    'data_compra',
    'dt_venda',
    'emissao',
    'data_emissao',
    'dt_emissao',
    'date',
    'data_pedido',
  ],
};

/** Headers genéricos "nome" — resolvidos depois pelo kind. */
const AMBIGUOUS_NAME_ALIASES = ['nome', 'name', 'nome_completo_alternativo'];

export type ColumnMapping = {
  field: Field;
  index: number;
  header: string;
  confidence: number;
};

export type SheetMeta = {
  name: string;
  kind: SheetKind;
  confidence: number;
  reasons: string[];
  columnMap: Partial<Record<Field, ColumnMapping>>;
  unmappedHeaders: string[];
  sampleRows: string[][];
  headerRowIndex: number;
  /** Original header labels by column index */
  headers: string[];
};

export type AnalyzedSheet = {
  meta: SheetMeta;
  /** Full data rows (after header), aligned to headers */
  rows: string[][];
  headers: string[];
};

const PHONE_RE = /^\d{10,13}$/;
const CPF_RE = /^\d{11}$/;
const CNPJ_RE = /^\d{14}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EAN_RE = /^\d{8,14}$/;

function digits(value: string): string {
  return value.replace(/\D/g, '');
}

function sampleCells(rows: string[][], col: number, max = 40): string[] {
  const out: string[] = [];
  for (const row of rows) {
    const v = (row[col] ?? '').trim();
    if (v) out.push(v);
    if (out.length >= max) break;
  }
  return out;
}

function ratio(cells: string[], pred: (v: string) => boolean): number {
  if (cells.length === 0) return 0;
  let hit = 0;
  for (const c of cells) if (pred(c)) hit++;
  return hit / cells.length;
}

function looksPhone(v: string): boolean {
  const d = digits(v);
  return PHONE_RE.test(d) && (d.length === 10 || d.length === 11 || d.startsWith('55'));
}

function looksCpf(v: string): boolean {
  const d = digits(v);
  return CPF_RE.test(d) || CNPJ_RE.test(d);
}

function looksMoney(v: string): boolean {
  return parseMoneyToCents(v) != null && /[\d]/.test(v);
}

function looksEmail(v: string): boolean {
  return EMAIL_RE.test(v.trim());
}

function looksSku(v: string): boolean {
  const t = v.trim();
  if (EAN_RE.test(digits(t)) && digits(t).length >= 8) return true;
  if (/^[A-Za-z0-9\-_.]{2,32}$/.test(t) && /\d/.test(t) && /[A-Za-z]/.test(t))
    return true;
  return false;
}

function looksDate(v: string): boolean {
  return parseDateBr(v) != null;
}

function looksStock(v: string): boolean {
  const n = Number(v.replace(',', '.').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) && n >= 0 && n === Math.floor(n) && n < 1_000_000;
}

/** Score how much a raw line looks like a header row. */
export function scoreHeaderRow(cells: string[]): number {
  let score = 0;
  const allAliases = new Set(
    Object.values(HEADER_ALIASES).flat().concat(AMBIGUOUS_NAME_ALIASES),
  );
  for (const cell of cells) {
    const h = normalizeHeader(cell);
    if (!h) continue;
    if (allAliases.has(h)) score += 3;
    else if (/^[a-z_]+$/.test(h) && h.length > 2) score += 1;
    if (looksMoney(cell) || looksPhone(cell) || looksDate(cell)) score -= 2;
  }
  return score;
}

export function findHeaderRowIndex(table: string[][]): number {
  const limit = Math.min(5, table.length);
  let bestIdx = 0;
  let bestScore = -Infinity;
  for (let i = 0; i < limit; i++) {
    const s = scoreHeaderRow(table[i] ?? []);
    if (s > bestScore) {
      bestScore = s;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function matchAliasField(normalized: string): Field | 'ambiguous_name' | null {
  if (AMBIGUOUS_NAME_ALIASES.includes(normalized)) return 'ambiguous_name';
  for (const field of ALL_FIELDS) {
    if (HEADER_ALIASES[field].includes(normalized)) return field;
  }
  return null;
}

function contentScores(
  cells: string[],
): Partial<Record<Field, number>> {
  return {
    telefone: ratio(cells, looksPhone),
    cpf: ratio(cells, looksCpf),
    email: ratio(cells, looksEmail),
    preco: ratio(cells, looksMoney) * 0.9,
    valor_total: ratio(cells, looksMoney) * 0.85,
    data: ratio(cells, looksDate),
    sku: ratio(cells, looksSku),
    estoque: ratio(cells, looksStock) * 0.7,
    quantidade: ratio(cells, looksStock) * 0.5,
  };
}

/**
 * Map columns using header aliases + content heuristics.
 * `kindHint` resolves ambiguous "nome"/"name".
 */
export function mapColumns(
  headers: string[],
  dataRows: string[][],
  kindHint?: SheetKind | null,
): {
  columnMap: Partial<Record<Field, ColumnMapping>>;
  unmappedHeaders: string[];
} {
  const columnMap: Partial<Record<Field, ColumnMapping>> = {};
  const claimed = new Set<number>();
  const unmapped: string[] = [];

  // Pass 1: strong header aliases (non-ambiguous)
  headers.forEach((header, index) => {
    const norm = normalizeHeader(header);
    const matched = matchAliasField(norm);
    if (!matched || matched === 'ambiguous_name') return;
    if (columnMap[matched]) return;
    columnMap[matched] = {
      field: matched,
      index,
      header,
      confidence: 0.95,
    };
    claimed.add(index);
  });

  // Pass 2: content classification for unclaimed columns
  headers.forEach((header, index) => {
    if (claimed.has(index)) return;
    const cells = sampleCells(dataRows, index);
    const scores = contentScores(cells);
    let best: Field | null = null;
    let bestScore = 0.55;
    for (const [field, score] of Object.entries(scores) as [Field, number][]) {
      if (columnMap[field]) continue;
      if (score > bestScore) {
        bestScore = score;
        best = field;
      }
    }
    if (best) {
      columnMap[best] = {
        field: best,
        index,
        header,
        confidence: Math.min(0.9, bestScore),
      };
      claimed.add(index);
    }
  });

  // Pass 3: ambiguous name columns
  headers.forEach((header, index) => {
    if (claimed.has(index)) return;
    const norm = normalizeHeader(header);
    if (!AMBIGUOUS_NAME_ALIASES.includes(norm) && norm !== 'nome' && norm !== 'name')
      return;

    let field: Field = 'cliente';
    let confidence = 0.55;
    if (kindHint === 'products') {
      field = 'produto';
      confidence = 0.85;
    } else if (kindHint === 'customers') {
      field = 'cliente';
      confidence = 0.85;
    } else if (kindHint === 'sales') {
      // Prefer product if produto already missing and cliente exists, else cliente
      if (!columnMap.produto && columnMap.cliente) {
        field = 'produto';
        confidence = 0.7;
      } else if (!columnMap.cliente) {
        field = 'cliente';
        confidence = 0.7;
      } else {
        field = 'produto';
        confidence = 0.6;
      }
    } else {
      // ambiguous kind: if phone/cpf present → cliente; if price/sku → produto
      if (columnMap.telefone || columnMap.cpf) {
        field = 'cliente';
        confidence = 0.75;
      } else if (columnMap.preco || columnMap.sku || columnMap.estoque) {
        field = 'produto';
        confidence = 0.75;
      } else {
        return; // leave unmapped until kind chosen
      }
    }

    if (columnMap[field]) return;
    columnMap[field] = { field, index, header, confidence };
    claimed.add(index);
  });

  headers.forEach((header, index) => {
    if (!claimed.has(index) && header.trim()) unmapped.push(header);
  });

  return { columnMap, unmappedHeaders: unmapped };
}

export function classifySheet(
  columnMap: Partial<Record<Field, ColumnMapping>>,
  dataRows: string[][],
): { kind: SheetKind; confidence: number; reasons: string[] } {
  const reasons: string[] = [];
  let customerScore = 0;
  let productScore = 0;
  let salesScore = 0;

  if (columnMap.telefone) {
    customerScore += 3;
    reasons.push('coluna de telefone');
  }
  if (columnMap.cpf) {
    customerScore += 2;
    reasons.push('coluna de documento');
  }
  if (columnMap.email) {
    customerScore += 1.5;
    reasons.push('coluna de e-mail');
  }
  if (columnMap.cliente) {
    customerScore += 2;
    reasons.push('coluna de cliente');
  }

  if (columnMap.produto) {
    productScore += 2;
    reasons.push('coluna de produto');
  }
  if (columnMap.sku) {
    productScore += 2.5;
    reasons.push('coluna de SKU/código');
  }
  if (columnMap.estoque) {
    productScore += 2;
    reasons.push('coluna de estoque');
  }
  if (columnMap.preco) {
    productScore += 1.5;
    reasons.push('coluna de preço');
  }
  if (columnMap.categoria) {
    productScore += 1;
    reasons.push('coluna de categoria');
  }
  if (columnMap.custo) {
    productScore += 1;
    reasons.push('coluna de custo');
  }

  const hasCustomerSide = Boolean(
    columnMap.cliente || columnMap.telefone || columnMap.cpf,
  );
  const hasProductSide = Boolean(
    columnMap.produto || columnMap.sku || columnMap.preco,
  );

  if (hasCustomerSide && hasProductSide) {
    salesScore += 4;
    reasons.push('cliente e produto na mesma planilha');
  }
  if (columnMap.quantidade && hasProductSide) {
    salesScore += 1.5;
    reasons.push('quantidade vendida');
  }
  if (columnMap.data && (hasCustomerSide || hasProductSide)) {
    salesScore += 1;
    reasons.push('coluna de data');
  }
  if (columnMap.valor_total && hasProductSide) {
    salesScore += 1.5;
    reasons.push('valor total');
  }

  // Content boost: phone density
  if (columnMap.telefone) {
    const cells = sampleCells(dataRows, columnMap.telefone.index);
    if (ratio(cells, looksPhone) > 0.5) customerScore += 1;
  }

  const max = Math.max(customerScore, productScore, salesScore);
  if (max < 2) {
    return {
      kind: 'ambiguous',
      confidence: 0.3,
      reasons: reasons.length ? reasons : ['poucos sinais reconhecíveis'],
    };
  }

  // Clear winner?
  const scores = [
    { kind: 'sales' as const, score: salesScore },
    { kind: 'customers' as const, score: customerScore },
    { kind: 'products' as const, score: productScore },
  ].sort((a, b) => b.score - a.score);

  const [first, second] = scores;
  const margin = first.score - second.score;
  const confidence = Math.min(
    0.98,
    0.45 + first.score * 0.08 + Math.max(0, margin) * 0.05,
  );

  // Prefer sales when both sides present strongly
  if (
    salesScore >= 3.5 &&
    salesScore >= customerScore - 0.5 &&
    salesScore >= productScore - 0.5
  ) {
    return { kind: 'sales', confidence: Math.max(confidence, 0.7), reasons };
  }

  if (margin < 1.2 && first.score < 4) {
    return {
      kind: 'ambiguous',
      confidence: Math.min(confidence, 0.55),
      reasons,
    };
  }

  return { kind: first.kind, confidence, reasons };
}

export function analyzeTable(
  table: string[][],
  sheetName: string,
  forcedKind?: SheetKind | null,
): AnalyzedSheet {
  if (table.length === 0) {
    return {
      meta: {
        name: sheetName,
        kind: 'ambiguous',
        confidence: 0,
        reasons: ['planilha vazia'],
        columnMap: {},
        unmappedHeaders: [],
        sampleRows: [],
        headerRowIndex: 0,
        headers: [],
      },
      rows: [],
      headers: [],
    };
  }

  const headerRowIndex = findHeaderRowIndex(table);
  const headers = (table[headerRowIndex] ?? []).map((h) => h.trim());
  const rows = table
    .slice(headerRowIndex + 1)
    .filter((r) => r.some((c) => (c ?? '').trim().length > 0));

  // First pass without kind hint
  let { columnMap, unmappedHeaders } = mapColumns(headers, rows, forcedKind);
  let classification = forcedKind
    ? {
        kind: forcedKind,
        confidence: 1,
        reasons: ['definido pelo lojista'],
      }
    : classifySheet(columnMap, rows);

  // Remap ambiguous names with classified kind
  if (!forcedKind) {
    const remapped = mapColumns(headers, rows, classification.kind);
    columnMap = remapped.columnMap;
    unmappedHeaders = remapped.unmappedHeaders;
    classification = classifySheet(columnMap, rows);
  } else {
    const remapped = mapColumns(headers, rows, forcedKind);
    columnMap = remapped.columnMap;
    unmappedHeaders = remapped.unmappedHeaders;
  }

  const sampleRows = rows.slice(0, 5).map((r) =>
    headers.map((_, i) => (r[i] ?? '').slice(0, 80)),
  );

  return {
    meta: {
      name: sheetName,
      kind: forcedKind ?? classification.kind,
      confidence: forcedKind ? 1 : classification.confidence,
      reasons: classification.reasons,
      columnMap,
      unmappedHeaders,
      sampleRows,
      headerRowIndex,
      headers,
    },
    rows,
    headers,
  };
}

function getCell(
  row: string[],
  map: Partial<Record<Field, ColumnMapping>>,
  field: Field,
): string {
  const m = map[field];
  if (!m) return '';
  return (row[m.index] ?? '').trim();
}

export type ExtractedPreview = {
  customers: {
    name: string;
    phone?: string;
    cpf?: string;
  }[];
  products: {
    name: string;
    sku?: string;
    category?: string;
    priceCents?: number;
    costCents?: number;
    stock?: number;
  }[];
  sales: {
    customerName?: string;
    customerPhone?: string;
    customerCpf?: string;
    productName: string;
    productSku?: string;
    quantity: number;
    amountCents: number;
    soldAt?: string;
  }[];
  warnings: string[];
};

export function extractFromAnalyzedSheet(
  sheet: AnalyzedSheet,
): ExtractedPreview {
  const preview: ExtractedPreview = {
    customers: [],
    products: [],
    sales: [],
    warnings: [],
  };
  const { meta, rows } = sheet;
  const map = meta.columnMap;
  const kind = meta.kind;
  const label = meta.name;

  if (kind === 'ambiguous') {
    preview.warnings.push(
      `${label}: não tivemos certeza se é lista de clientes ou produtos — escolha abaixo.`,
    );
    return preview;
  }

  const seenCustomers = new Set<string>();
  const seenProducts = new Set<string>();
  let skippedNoPhone = 0;
  let skippedNoPrice = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const lineNo = meta.headerRowIndex + i + 2;

    let clienteNome = getCell(row, map, 'cliente');
    let produtoNome = getCell(row, map, 'produto');
    const telefone = getCell(row, map, 'telefone');
    const cpf = getCell(row, map, 'cpf');
    const sku = getCell(row, map, 'sku');
    const categoria = getCell(row, map, 'categoria');
    const precoRaw = getCell(row, map, 'preco');
    const custoRaw = getCell(row, map, 'custo');
    const estoqueRaw = getCell(row, map, 'estoque');
    const qtdRaw = getCell(row, map, 'quantidade');
    const totalRaw = getCell(row, map, 'valor_total');
    const dataRaw = getCell(row, map, 'data');

    // If kind is products and only "nome" mapped to produto
    if (kind === 'products' && !produtoNome && clienteNome) {
      produtoNome = clienteNome;
      clienteNome = '';
    }
    if (kind === 'customers' && !clienteNome && produtoNome) {
      clienteNome = produtoNome;
      produtoNome = '';
    }

    const precoCents = precoRaw ? parseMoneyToCents(precoRaw) : null;
    const custoCents = custoRaw ? parseMoneyToCents(custoRaw) : null;
    const totalCents = totalRaw ? parseMoneyToCents(totalRaw) : null;
    const quantity = Math.max(
      1,
      Number(String(qtdRaw).replace(/\D/g, '')) || 1,
    );
    const stock =
      estoqueRaw && looksStock(estoqueRaw)
        ? Math.floor(Number(estoqueRaw.replace(',', '.').replace(/[^\d.-]/g, '')))
        : undefined;
    const soldAt = dataRaw ? parseDateBr(dataRaw) : null;

    const pushCustomer = () => {
      if (!clienteNome) return;
      const hasId =
        (telefone && digits(telefone).length >= 10) ||
        (cpf && digits(cpf).length >= 11);
      if (!hasId) {
        skippedNoPhone++;
        return;
      }
      const key =
        (telefone && `p:${digits(telefone)}`) ||
        (cpf && `c:${digits(cpf)}`) ||
        `n:${clienteNome.toLowerCase()}`;
      if (seenCustomers.has(key)) return;
      seenCustomers.add(key);
      preview.customers.push({
        name: clienteNome,
        phone: telefone || undefined,
        cpf: cpf || undefined,
      });
    };

    const pushProduct = () => {
      if (!produtoNome) return;
      if (precoCents == null || precoCents <= 0) {
        // Allow product without price only if we have sku (still warn)
        if (kind === 'products') {
          skippedNoPrice++;
          return;
        }
      }
      const key = sku
        ? `s:${sku.toUpperCase()}`
        : `n:${produtoNome.toLowerCase()}`;
      if (seenProducts.has(key)) return;
      seenProducts.add(key);
      preview.products.push({
        name: produtoNome,
        sku: sku || undefined,
        category: categoria || undefined,
        priceCents: precoCents && precoCents > 0 ? precoCents : undefined,
        costCents: custoCents && custoCents > 0 ? custoCents : undefined,
        stock,
      });
    };

    if (kind === 'customers') {
      pushCustomer();
      continue;
    }

    if (kind === 'products') {
      pushProduct();
      continue;
    }

    // sales
    pushCustomer();
    pushProduct();

    if (produtoNome) {
      const amountCents =
        totalCents ??
        (precoCents != null && precoCents > 0 ? precoCents * quantity : null);
      if (amountCents != null && amountCents > 0) {
        preview.sales.push({
          customerName: clienteNome || undefined,
          customerPhone: telefone || undefined,
          customerCpf: cpf || undefined,
          productName: produtoNome,
          productSku: sku || undefined,
          quantity,
          amountCents,
          soldAt: soldAt ?? undefined,
        });
      } else if (dataRaw && !soldAt) {
        preview.warnings.push(
          `${label} linha ${lineNo}: data "${dataRaw}" inválida.`,
        );
      }
    }
  }

  if (skippedNoPhone > 0) {
    preview.warnings.push(
      `${label}: ${skippedNoPhone} nome(s) sem WhatsApp/CPF — não entram no disparo. Inclua uma coluna de telefone.`,
    );
  }
  if (skippedNoPrice > 0) {
    preview.warnings.push(
      `${label}: ${skippedNoPrice} produto(s) sem preço válido — ignorados.`,
    );
  }

  return preview;
}

/** Apply manual column map overrides (field → header index). */
export function applyColumnOverrides(
  sheet: AnalyzedSheet,
  overrides: Partial<Record<Field, number>>,
  kind: SheetKind,
): AnalyzedSheet {
  const columnMap: Partial<Record<Field, ColumnMapping>> = {};
  for (const [field, index] of Object.entries(overrides) as [Field, number][]) {
    if (index == null || index < 0) continue;
    columnMap[field] = {
      field,
      index,
      header: sheet.headers[index] ?? `col_${index}`,
      confidence: 1,
    };
  }
  const next: AnalyzedSheet = {
    ...sheet,
    meta: {
      ...sheet.meta,
      kind,
      confidence: 1,
      reasons: ['ajustado pelo lojista'],
      columnMap,
      unmappedHeaders: sheet.headers.filter(
        (_, i) => !Object.values(columnMap).some((m) => m?.index === i),
      ),
      headers: sheet.headers,
    },
  };
  return next;
}
