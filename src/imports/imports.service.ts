import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import {
  encryptPhone,
  hashPhone,
  maskPhone,
  normalizePhoneBr,
} from '../common/phone.util';
import {
  AnalyzedSheet,
  ImportFile,
  ImportJobPayload,
  ImportParser,
  ImportPreview,
  SheetKind,
  SheetMeta,
  mergeExtracted,
  mergeParserResults,
  sheetsNeedUserChoice,
} from './import.types';
import {
  ALL_FIELDS,
  Field,
  analyzeTable,
  applyColumnOverrides,
  extractFromAnalyzedSheet,
} from './sheet-analysis';
import { CsvImportParser } from './csv-import.parser';
import { NfeXmlImportParser } from './nfe-import.parser';
import { XlsxImportParser } from './xlsx-import.parser';
import { AiImportParser } from './ai-import.parser';
import { ImportAiClient } from './ai-import.client';
import { AiSheetAssistant } from './ai-sheet-assistant';

export type CommitSummary = {
  jobId: string;
  customersCreated: number;
  customersUpdated: number;
  productsCreated: number;
  productsUpdated: number;
  salesCreated: number;
  salesSkipped: number;
  warnings: string[];
};

export type PreviewResponse = {
  jobId: string;
  preview: ImportPreview;
  sheets: SheetMeta[];
  needsUserChoice?: { sheet: string; options: SheetKind[] };
};

function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function serializePayload(
  preview: ImportPreview,
  sheets: AnalyzedSheet[],
): ImportJobPayload {
  return {
    preview,
    sheets: sheets.map((s) => ({
      name: s.meta.name,
      headers: s.headers,
      rows: s.rows,
      meta: s.meta,
    })),
  };
}

function deserializeSheets(payload: ImportJobPayload): AnalyzedSheet[] {
  return (payload.sheets ?? []).map((s) => ({
    meta: s.meta,
    headers: s.headers,
    rows: s.rows,
  }));
}

function publicSheets(sheets: AnalyzedSheet[]): SheetMeta[] {
  return sheets.map((s) => ({
    ...s.meta,
    headers: s.headers.length ? s.headers : s.meta.headers ?? [],
  }));
}

function saleFingerprint(input: {
  storeId: string;
  phone?: string;
  cpf?: string;
  productName: string;
  productSku?: string;
  soldAt?: string;
  amountCents: number;
}): string {
  const id =
    (input.phone && `p:${input.phone.replace(/\D/g, '')}`) ||
    (input.cpf && `c:${input.cpf.replace(/\D/g, '')}`) ||
    'anon';
  const prod = input.productSku
    ? `s:${input.productSku.toUpperCase()}`
    : `n:${normalizeName(input.productName)}`;
  const day = input.soldAt ? input.soldAt.slice(0, 10) : 'nodate';
  const raw = `${input.storeId}|${id}|${prod}|${day}|${input.amountCents}`;
  return createHash('sha256').update(raw).digest('hex').slice(0, 32);
}

@Injectable()
export class ImportsService {
  private readonly parsers: ImportParser[];

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiAssistant: AiSheetAssistant,
    private readonly aiClient: ImportAiClient,
    nfeParser: NfeXmlImportParser,
    csvParser: CsvImportParser,
    xlsxParser: XlsxImportParser,
    aiParser: AiImportParser,
  ) {
    // Ordem: estruturados primeiro; AI por último (só se configurada + detect).
    this.parsers = [nfeParser, xlsxParser, csvParser, aiParser];
  }

  health() {
    const ai = this.aiClient.getConfig();
    return {
      module: 'imports',
      status: 'ok',
      parsers: ['nfe_xml', 'xlsx', 'csv', 'ai_text'],
      ai: {
        enabled: ai.enabled,
        ready: this.aiClient.isReady(),
        model: ai.enabled ? ai.model : null,
        baseUrl: ai.enabled ? ai.baseUrl : null,
      },
    };
  }

  async preview(input: {
    tenantId: string;
    storeId: string;
    files: ImportFile[];
  }): Promise<PreviewResponse> {
    const store = await this.prisma.store.findFirst({
      where: { id: input.storeId, tenantId: input.tenantId },
    });
    if (!store) {
      throw new BadRequestException('Loja não encontrada para este tenant.');
    }

    const results = [];
    const unrecognized: string[] = [];

    for (const file of input.files) {
      const parser = this.parsers.find((p) => p.detect(file));
      if (!parser) {
        unrecognized.push(file.name);
        continue;
      }
      results.push(await Promise.resolve(parser.parse(file)));
    }

    if (results.length === 0) {
      throw new BadRequestException(
        `Nenhum arquivo reconhecido (${unrecognized.join(', ')}). ` +
          'Envie planilhas CSV/Excel (.xlsx) ou XMLs de NF-e/NFC-e.' +
          (this.aiClient.isReady()
            ? ''
            : ' (LLM de importação desligada — configure IMPORT_AI_* para formatos atípicos.)'),
      );
    }

    let { preview, sheets } = mergeParserResults(results);

    // Refino por LLM em abas ambíguas / baixa confiança
    if (sheets.length > 0 && this.aiAssistant.isReady()) {
      const refined = await this.aiAssistant.refineSheets(sheets);
      sheets = refined.sheets;
      preview = mergeExtracted(refined.extracted, preview.sourceType);
      if (refined.usedAi) {
        preview.warnings.unshift(
          'Classificação assistida por IA aplicada em uma ou mais abas.',
        );
      }
    }

    for (const name of unrecognized) {
      preview.warnings.push(
        `${name}: formato não reconhecido — salve como CSV/Excel ou exporte o XML da nota.`,
      );
    }

    const payload = serializePayload(preview, sheets);
    const job = await this.prisma.importJob.create({
      data: {
        tenantId: input.tenantId,
        storeId: input.storeId,
        sourceType: preview.sourceType,
        status: 'preview',
        fileName: input.files.map((f) => f.name).join(', ').slice(0, 250),
        payload: JSON.stringify(payload),
        customersCount: preview.customers.length,
        productsCount: preview.products.length,
        salesCount: preview.sales.length,
      },
    });

    return {
      jobId: job.id,
      preview,
      sheets: publicSheets(sheets),
      needsUserChoice: sheetsNeedUserChoice(sheets),
    };
  }

  async remap(
    tenantId: string,
    jobId: string,
    input: {
      sheetName: string;
      kind: SheetKind;
      columnMap?: Partial<Record<Field, number>>;
    },
  ): Promise<PreviewResponse> {
    const job = await this.prisma.importJob.findFirst({
      where: { id: jobId, tenantId },
    });
    if (!job) throw new NotFoundException('Importação não encontrada.');
    if (job.status === 'committed') {
      throw new BadRequestException('Esta importação já foi confirmada.');
    }

    const payload = JSON.parse(job.payload) as ImportJobPayload;
    const sheets = deserializeSheets(payload);
    if (sheets.length === 0) {
      throw new BadRequestException(
        'Este arquivo não permite remapeamento (ex.: XML de nota). Envie uma planilha.',
      );
    }

    const idx = sheets.findIndex((s) => s.meta.name === input.sheetName);
    if (idx < 0) {
      throw new BadRequestException(`Aba "${input.sheetName}" não encontrada.`);
    }

    let sheet = sheets[idx];
    if (input.columnMap && Object.keys(input.columnMap).length > 0) {
      sheet = applyColumnOverrides(sheet, input.columnMap, input.kind);
    } else {
      const table = [sheet.headers, ...sheet.rows];
      sheet = analyzeTable(table, sheet.meta.name, input.kind);
    }
    sheets[idx] = sheet;

    const extracted = sheets.map(extractFromAnalyzedSheet);
    // Keep NFe-only warnings from previous preview that aren't sheet-based
    const nfeWarnings = (payload.preview?.warnings ?? []).filter((w) =>
      /nota|NF-e|XML/i.test(w),
    );
    const preview = mergeExtracted(
      extracted,
      payload.preview.sourceType === 'mixed'
        ? 'mixed'
        : payload.preview.sourceType,
    );
    preview.warnings = [...nfeWarnings, ...preview.warnings];

    const nextPayload = serializePayload(preview, sheets);
    await this.prisma.importJob.update({
      where: { id: job.id },
      data: {
        payload: JSON.stringify(nextPayload),
        customersCount: preview.customers.length,
        productsCount: preview.products.length,
        salesCount: preview.sales.length,
      },
    });

    return {
      jobId: job.id,
      preview,
      sheets: publicSheets(sheets),
      needsUserChoice: sheetsNeedUserChoice(sheets),
    };
  }

  async commit(tenantId: string, jobId: string): Promise<CommitSummary> {
    const job = await this.prisma.importJob.findFirst({
      where: { id: jobId, tenantId },
    });
    if (!job) throw new NotFoundException('Importação não encontrada.');
    if (job.status === 'committed') {
      throw new BadRequestException('Esta importação já foi confirmada.');
    }

    const raw = JSON.parse(job.payload) as ImportJobPayload | ImportPreview;
    const preview: ImportPreview =
      'preview' in raw && raw.preview ? raw.preview : (raw as ImportPreview);

    const { storeId } = job;
    const warnings: string[] = [];

    const productIdBySku = new Map<string, string>();
    const productIdByName = new Map<string, string>();
    let productsCreated = 0;
    let productsUpdated = 0;

    const existingProducts = await this.prisma.product.findMany({
      where: { tenantId, storeId },
    });
    for (const p of existingProducts) {
      if (p.sku) productIdBySku.set(p.sku.toUpperCase(), p.id);
      productIdByName.set(normalizeName(p.name), p.id);
    }

    const resolveProduct = async (prod: {
      name: string;
      sku?: string;
      priceCents?: number;
      costCents?: number;
      stock?: number;
      category?: string;
    }): Promise<string> => {
      const skuKey = prod.sku?.toUpperCase();
      const nameKey = normalizeName(prod.name);

      const existingId =
        (skuKey && productIdBySku.get(skuKey)) || productIdByName.get(nameKey);

      if (existingId) {
        const data: {
          priceCents?: number;
          costCents?: number | null;
          stock?: number;
          category?: string | null;
        } = {};
        if (prod.priceCents != null && prod.priceCents > 0) {
          data.priceCents = prod.priceCents;
        }
        if (prod.costCents != null && prod.costCents > 0) {
          data.costCents = prod.costCents;
        }
        if (prod.stock != null && prod.stock >= 0) {
          data.stock = prod.stock;
        }
        if (prod.category) {
          data.category = prod.category;
        }
        if (Object.keys(data).length > 0) {
          await this.prisma.product.update({
            where: { id: existingId },
            data,
          });
          productsUpdated++;
        }
        return existingId;
      }

      const created = await this.prisma.product.create({
        data: {
          tenantId,
          storeId,
          name: prod.name,
          sku: prod.sku ?? null,
          category: prod.category ?? null,
          priceCents: prod.priceCents ?? 0,
          costCents: prod.costCents ?? null,
          stock: prod.stock ?? 0,
        },
      });
      productsCreated++;
      if (skuKey) productIdBySku.set(skuKey, created.id);
      productIdByName.set(nameKey, created.id);
      return created.id;
    };

    for (const prod of preview.products) {
      await resolveProduct(prod);
    }

    let customersCreated = 0;
    let customersUpdated = 0;
    const customerIdByHash = new Map<string, string>();

    const customerHashFor = (phone?: string, cpf?: string): string | null => {
      if (phone && phone.replace(/\D/g, '').length >= 10) {
        return hashPhone(normalizePhoneBr(phone));
      }
      const cpfDigits = cpf?.replace(/\D/g, '');
      if (cpfDigits && cpfDigits.length >= 11) {
        return hashPhone(`cpf:${cpfDigits}`);
      }
      return null;
    };

    const resolveCustomer = async (
      name: string,
      phone?: string,
      cpf?: string,
    ): Promise<string | null> => {
      const hash = customerHashFor(phone, cpf);
      if (!hash) return null;

      if (customerIdByHash.has(hash)) return customerIdByHash.get(hash)!;

      const existing = await this.prisma.customer.findFirst({
        where: { tenantId, storeId, phoneHash: hash },
      });
      if (existing) {
        if (name && name !== existing.displayName) {
          await this.prisma.customer.update({
            where: { id: existing.id },
            data: { displayName: name },
          });
        }
        customerIdByHash.set(hash, existing.id);
        customersUpdated++;
        return existing.id;
      }

      const hasPhone = Boolean(phone && phone.replace(/\D/g, '').length >= 10);
      const e164 = hasPhone ? normalizePhoneBr(phone!) : null;
      const cpfDigits = cpf?.replace(/\D/g, '');

      const created = await this.prisma.customer.create({
        data: {
          tenantId,
          storeId,
          displayName: name,
          phoneHash: hash,
          phoneEnc: e164 ? encryptPhone(e164) : null,
          phoneMasked: e164
            ? maskPhone(e164)
            : cpfDigits
              ? `CPF •••${cpfDigits.slice(-2)}`
              : null,
          notes: 'Importado automaticamente',
        },
      });
      customersCreated++;
      customerIdByHash.set(hash, created.id);
      return created.id;
    };

    for (const c of preview.customers) {
      const id = await resolveCustomer(c.name, c.phone, c.cpf);
      if (!id) {
        warnings.push(
          `Cliente "${c.name}" sem telefone/CPF — não importado (sem chave de identificação).`,
        );
      }
    }

    let anonCustomerId: string | null = null;
    const getAnonCustomer = async (): Promise<string> => {
      if (anonCustomerId) return anonCustomerId;
      const hash = hashPhone(`anon:${storeId}`);
      const existing = await this.prisma.customer.findFirst({
        where: { tenantId, storeId, phoneHash: hash },
      });
      if (existing) {
        anonCustomerId = existing.id;
        return existing.id;
      }
      const created = await this.prisma.customer.create({
        data: {
          tenantId,
          storeId,
          displayName: 'Consumidor final (importado)',
          phoneHash: hash,
          notes:
            'Cliente sintético para vendas importadas sem identificação. Não recebe disparos.',
        },
      });
      anonCustomerId = created.id;
      return created.id;
    };

    let salesCreated = 0;
    let salesSkipped = 0;

    // Load recent import sale fingerprints from events metadata
    const recentEvents = await this.prisma.customerEvent.findMany({
      where: {
        tenantId,
        storeId,
        type: 'sale',
        metadata: { contains: 'importFingerprint' },
      },
      take: 5000,
      select: { metadata: true },
    });
    const seenFingerprints = new Set<string>();
    for (const ev of recentEvents) {
      try {
        const meta = JSON.parse(ev.metadata ?? '{}') as {
          importFingerprint?: string;
        };
        if (meta.importFingerprint) seenFingerprints.add(meta.importFingerprint);
      } catch {
        /* ignore */
      }
    }

    for (const sale of preview.sales) {
      const fp = saleFingerprint({
        storeId,
        phone: sale.customerPhone,
        cpf: sale.customerCpf,
        productName: sale.productName,
        productSku: sale.productSku,
        soldAt: sale.soldAt,
        amountCents: sale.amountCents,
      });
      if (seenFingerprints.has(fp)) {
        salesSkipped++;
        continue;
      }

      const productId = await resolveProduct({
        name: sale.productName,
        sku: sale.productSku,
      });

      let customerId =
        sale.customerName || sale.customerPhone || sale.customerCpf
          ? await resolveCustomer(
              sale.customerName ?? 'Cliente importado',
              sale.customerPhone,
              sale.customerCpf,
            )
          : null;

      if (!customerId) customerId = await getAnonCustomer();

      const created = await this.prisma.sale.create({
        data: {
          tenantId,
          storeId,
          customerId,
          productId,
          amountCents: sale.amountCents,
          source: 'import',
          soldAt: sale.soldAt ? new Date(sale.soldAt) : new Date(),
        },
      });
      salesCreated++;
      seenFingerprints.add(fp);

      await this.prisma.customerEvent.create({
        data: {
          tenantId,
          storeId,
          customerId,
          type: 'sale',
          title: `Compra importada: ${sale.productName}`,
          detail: `R$ ${(sale.amountCents / 100).toFixed(2).replace('.', ',')} · qtde ${sale.quantity}`,
          metadata: JSON.stringify({
            saleId: created.id,
            importJobId: job.id,
            importFingerprint: fp,
          }),
          occurredAt: sale.soldAt ? new Date(sale.soldAt) : new Date(),
        },
      });
    }

    if (salesSkipped > 0) {
      warnings.push(
        `${salesSkipped} venda(s) já existiam e foram ignoradas (reimportação).`,
      );
    }

    await this.prisma.importJob.update({
      where: { id: job.id },
      data: {
        status: 'committed',
        committedAt: new Date(),
        errors: warnings.length ? JSON.stringify(warnings) : null,
      },
    });

    return {
      jobId: job.id,
      customersCreated,
      customersUpdated,
      productsCreated,
      productsUpdated,
      salesCreated,
      salesSkipped,
      warnings,
    };
  }

  async listJobs(tenantId: string, storeId?: string) {
    return this.prisma.importJob.findMany({
      where: { tenantId, ...(storeId ? { storeId } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        sourceType: true,
        status: true,
        fileName: true,
        customersCount: true,
        productsCount: true,
        salesCount: true,
        committedAt: true,
        createdAt: true,
      },
    });
  }
}

export { ALL_FIELDS };
