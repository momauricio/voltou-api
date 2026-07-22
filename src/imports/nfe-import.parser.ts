import { Injectable } from '@nestjs/common';
import {
  ImportFile,
  ImportParser,
  ParserResult,
  emptyPreview,
  parseMoneyToCents,
} from './import.types';

/**
 * Parser de NF-e/NFC-e (XML). Extração leve por tags — o layout da nota é
 * padronizado pela SEFAZ, então regex em tags conhecidas é suficiente e evita
 * dependência de parser XML completo.
 */

function tagContent(xml: string, tag: string): string | null {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return match ? match[1].trim() : null;
}

function allBlocks(xml: string, tag: string): string[] {
  const blocks: string[] = [];
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    blocks.push(m[1]);
  }
  return blocks;
}

function decodeXml(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

@Injectable()
export class NfeXmlImportParser implements ImportParser {
  detect(file: ImportFile): boolean {
    if (!/\.xml$/i.test(file.name) && !file.content.trimStart().startsWith('<')) {
      return false;
    }
    return /<(nfeProc|NFe|infNFe)[\s>]/i.test(file.content);
  }

  parse(file: ImportFile): ParserResult {
    const preview = emptyPreview('nfe_xml');
    const xml = file.content;

    const infNFe = tagContent(xml, 'infNFe');
    if (!infNFe) {
      preview.warnings.push(
        `${file.name}: não encontrei <infNFe> — o arquivo é uma NF-e/NFC-e válida?`,
      );
      return { preview, sheets: [] };
    }

    const ide = tagContent(infNFe, 'ide') ?? '';
    const dhEmi = tagContent(ide, 'dhEmi') ?? tagContent(ide, 'dEmi');
    let soldAt: string | undefined;
    if (dhEmi) {
      const parsed = Date.parse(dhEmi);
      if (!Number.isNaN(parsed)) soldAt = new Date(parsed).toISOString();
    }

    const dest = tagContent(infNFe, 'dest');
    let customerName: string | undefined;
    let customerPhone: string | undefined;
    let customerCpf: string | undefined;

    if (dest) {
      customerName = decodeXml(tagContent(dest, 'xNome') ?? '') || undefined;
      customerCpf =
        tagContent(dest, 'CPF') ?? tagContent(dest, 'CNPJ') ?? undefined;
      const fone = tagContent(dest, 'fone');
      if (fone && fone.replace(/\D/g, '').length >= 10) {
        customerPhone = fone;
      }
      if (customerName) {
        preview.customers.push({
          name: customerName,
          phone: customerPhone,
          cpf: customerCpf ?? undefined,
        });
      }
    } else {
      preview.warnings.push(
        `${file.name}: nota sem destinatário (consumidor final) — venda entra sem cliente identificado.`,
      );
    }

    const dets = allBlocks(infNFe, 'det');
    if (dets.length === 0) {
      preview.warnings.push(`${file.name}: nota sem itens <det>.`);
    }

    for (const det of dets) {
      const prod = tagContent(det, 'prod');
      if (!prod) continue;

      const name = decodeXml(tagContent(prod, 'xProd') ?? '');
      if (!name) continue;

      const ean = tagContent(prod, 'cEAN');
      const cProd = tagContent(prod, 'cProd');
      const sku =
        ean && ean.toUpperCase() !== 'SEM GTIN' && /\d{8,}/.test(ean)
          ? ean
          : cProd ?? undefined;

      const vUnCom = tagContent(prod, 'vUnCom');
      const qCom = tagContent(prod, 'qCom');
      const vProd = tagContent(prod, 'vProd');

      const priceCents = vUnCom ? parseMoneyToCents(vUnCom) : null;
      const quantity = qCom ? Math.max(1, Math.round(Number(qCom))) : 1;
      const totalCents = vProd ? parseMoneyToCents(vProd) : null;

      preview.products.push({
        name,
        sku: sku ?? undefined,
        priceCents: priceCents ?? undefined,
      });

      const amountCents =
        totalCents ?? (priceCents != null ? priceCents * quantity : null);
      if (amountCents != null && amountCents > 0) {
        preview.sales.push({
          customerName,
          customerPhone,
          customerCpf,
          productName: name,
          productSku: sku ?? undefined,
          quantity,
          amountCents,
          soldAt,
        });
      }
    }

    return { preview, sheets: [] };
  }
}
