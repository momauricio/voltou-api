import {
  AnalyzedSheet,
  ExtractedPreview,
  SheetKind,
  SheetMeta,
  extractFromAnalyzedSheet,
} from './sheet-analysis';

export type PreviewCustomer = {
  name: string;
  /** E.164-ish or raw digits */
  phone?: string;
  cpf?: string;
};

export type PreviewProduct = {
  name: string;
  sku?: string;
  category?: string;
  priceCents?: number;
  costCents?: number;
  stock?: number;
};

export type PreviewSale = {
  customerName?: string;
  customerPhone?: string;
  customerCpf?: string;
  productName: string;
  productSku?: string;
  quantity: number;
  amountCents: number;
  soldAt?: string;
};

export type ImportPreview = {
  sourceType: 'csv' | 'nfe_xml' | 'xlsx' | 'text' | 'mixed';
  customers: PreviewCustomer[];
  products: PreviewProduct[];
  sales: PreviewSale[];
  warnings: string[];
};

export type ImportFile = {
  name: string;
  /** UTF-8 text or base64 for binary (xlsx) */
  content: string;
  encoding?: 'utf8' | 'base64';
};

export interface ImportParser {
  detect(file: ImportFile): boolean;
  /** Parse into structured sheets + preview entities (sync or async for LLM). */
  parse(file: ImportFile): ParserResult | Promise<ParserResult>;
}

export type ParserResult = {
  preview: ImportPreview;
  sheets: AnalyzedSheet[];
};

/** Serializable job payload stored in ImportJob.payload */
export type ImportJobPayload = {
  preview: ImportPreview;
  sheets: {
    name: string;
    headers: string[];
    rows: string[][];
    meta: SheetMeta;
  }[];
};

export function emptyPreview(
  sourceType: ImportPreview['sourceType'],
): ImportPreview {
  return { sourceType, customers: [], products: [], sales: [], warnings: [] };
}

export function mergeExtracted(
  parts: ExtractedPreview[],
  sourceType: ImportPreview['sourceType'],
): ImportPreview {
  const merged = emptyPreview(sourceType);
  const customerKeys = new Set<string>();
  const productKeys = new Set<string>();

  for (const p of parts) {
    merged.warnings.push(...p.warnings);
    merged.sales.push(...p.sales);

    for (const c of p.customers) {
      const key =
        (c.phone && `p:${c.phone.replace(/\D/g, '')}`) ||
        (c.cpf && `c:${c.cpf.replace(/\D/g, '')}`) ||
        `n:${c.name.trim().toLowerCase()}`;
      if (customerKeys.has(key)) continue;
      customerKeys.add(key);
      merged.customers.push(c);
    }

    for (const prod of p.products) {
      const key = prod.sku
        ? `s:${prod.sku.toUpperCase()}`
        : `n:${prod.name.trim().toLowerCase()}`;
      if (productKeys.has(key)) continue;
      productKeys.add(key);
      merged.products.push(prod);
    }
  }

  return merged;
}

export function mergeParserResults(results: ParserResult[]): {
  preview: ImportPreview;
  sheets: AnalyzedSheet[];
} {
  const sheets = results.flatMap((r) => r.sheets);
  const sourceType: ImportPreview['sourceType'] =
    results.length === 1 ? results[0].preview.sourceType : 'mixed';
  const extracted = sheets.map(extractFromAnalyzedSheet);
  const preview = mergeExtracted(extracted, sourceType);
  for (const r of results) {
    preview.warnings.push(...r.preview.warnings);
  }
  return { preview, sheets };
}

/** Merge previews from multiple files into one (legacy helper for NFe). */
export function mergePreviews(previews: ImportPreview[]): ImportPreview {
  return mergeExtracted(previews, previews.length === 1 ? previews[0].sourceType : 'mixed');
}

export function parseMoneyToCents(raw: string): number | null {
  const cleaned = raw
    .trim()
    .replace(/R\$\s?/i, '')
    .replace(/\s/g, '');
  if (!cleaned) return null;
  let normalized = cleaned;
  if (cleaned.includes(',') && cleaned.includes('.')) {
    normalized = cleaned.replace(/\./g, '').replace(',', '.');
  } else if (cleaned.includes(',')) {
    normalized = cleaned.replace(',', '.');
  }
  const n = Number(normalized);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

/** DD/MM/YYYY, YYYY-MM-DD ou ISO → ISO string (12:00 local) */
export function parseDateBr(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;

  const br = value.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if (br) {
    const day = Number(br[1]);
    const month = Number(br[2]);
    let year = Number(br[3]);
    if (year < 100) year += 2000;
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const d = new Date(year, month - 1, day, 12, 0, 0, 0);
    if (d.getMonth() !== month - 1 || d.getDate() !== day) return null;
    return d.toISOString();
  }

  const parsed = Date.parse(value);
  if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
  return null;
}

export function sheetsNeedUserChoice(
  sheets: AnalyzedSheet[],
): { sheet: string; options: SheetKind[] } | undefined {
  const ambiguous = sheets.find(
    (s) => s.meta.kind === 'ambiguous' || s.meta.confidence < 0.6,
  );
  if (!ambiguous) return undefined;
  return {
    sheet: ambiguous.meta.name,
    options: ['customers', 'products', 'sales'],
  };
}

export type { SheetKind, SheetMeta, AnalyzedSheet };
