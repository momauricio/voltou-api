import { Injectable } from '@nestjs/common';
import {
  ImportFile,
  ImportParser,
  ParserResult,
  mergeExtracted,
} from './import.types';
import { parseCsvTable } from './csv.util';
import { analyzeTable, extractFromAnalyzedSheet } from './sheet-analysis';

@Injectable()
export class CsvImportParser implements ImportParser {
  detect(file: ImportFile): boolean {
    if (/\.(csv|txt)$/i.test(file.name)) return true;
    if (file.encoding === 'base64') return false;
    const head = file.content.slice(0, 2000);
    if (head.trimStart().startsWith('<')) return false;
    if (head.includes(',') || head.includes(';') || head.includes('\t'))
      return true;
    return false;
  }

  parse(file: ImportFile): ParserResult {
    const content =
      file.encoding === 'base64'
        ? Buffer.from(file.content, 'base64').toString('utf8')
        : file.content;

    // Latin-1 fallback if lots of replacement chars after assuming UTF-8 badly —
    // content is already a string from JSON; try as-is.
    let table = parseCsvTable(content);
    if (table.length === 0 && content.includes('\ufffd')) {
      // unlikely via JSON; keep as-is
    }

    const sheet = analyzeTable(table, file.name);
    const extracted = extractFromAnalyzedSheet(sheet);
    const preview = mergeExtracted([extracted], 'csv');

    if (
      preview.customers.length === 0 &&
      preview.products.length === 0 &&
      preview.sales.length === 0 &&
      sheet.meta.kind !== 'ambiguous'
    ) {
      preview.warnings.push(
        `${file.name}: nenhuma linha aproveitável encontrada.`,
      );
    }

    if (table.length < 2) {
      preview.warnings.push(
        `${file.name}: o arquivo precisa de cabeçalho e pelo menos uma linha de dados.`,
      );
    }

    return { preview, sheets: [sheet] };
  }
}
