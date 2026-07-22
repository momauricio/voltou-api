import { Injectable } from '@nestjs/common';
import * as XLSX from 'xlsx';
import {
  ImportFile,
  ImportParser,
  ParserResult,
  emptyPreview,
  mergeExtracted,
} from './import.types';
import { analyzeTable, extractFromAnalyzedSheet } from './sheet-analysis';

@Injectable()
export class XlsxImportParser implements ImportParser {
  detect(file: ImportFile): boolean {
    if (/\.xlsx?$/i.test(file.name)) return true;
    if (file.encoding === 'base64' && /\.xlsx?$/i.test(file.name)) return true;
    return false;
  }

  parse(file: ImportFile): ParserResult {
    const preview = emptyPreview('xlsx');
    let buffer: Buffer;
    try {
      buffer =
        file.encoding === 'base64'
          ? Buffer.from(file.content, 'base64')
          : Buffer.from(file.content, 'binary');
    } catch {
      preview.warnings.push(`${file.name}: não foi possível ler o Excel.`);
      return { preview, sheets: [] };
    }

    let workbook: XLSX.WorkBook;
    try {
      workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false });
    } catch {
      preview.warnings.push(
        `${file.name}: arquivo Excel inválido ou corrompido.`,
      );
      return { preview, sheets: [] };
    }

    const sheets = [];
    for (const sheetName of workbook.SheetNames) {
      const ws = workbook.Sheets[sheetName];
      if (!ws) continue;
      const raw = XLSX.utils.sheet_to_json<string[]>(ws, {
        header: 1,
        defval: '',
        raw: false,
      }) as string[][];
      const table = raw.map((row) =>
        (Array.isArray(row) ? row : []).map((c) => String(c ?? '').trim()),
      );
      if (table.length === 0) continue;
      const label =
        workbook.SheetNames.length > 1
          ? `${file.name} · ${sheetName}`
          : file.name;
      sheets.push(analyzeTable(table, label));
    }

    if (sheets.length === 0) {
      preview.warnings.push(`${file.name}: nenhuma aba com dados.`);
      return { preview, sheets: [] };
    }

    const extracted = sheets.map(extractFromAnalyzedSheet);
    const merged = mergeExtracted(extracted, 'xlsx');
    return { preview: merged, sheets };
  }
}
