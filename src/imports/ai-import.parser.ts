import { Injectable } from '@nestjs/common';
import {
  ImportFile,
  ImportParser,
  ParserResult,
  emptyPreview,
} from './import.types';
import { ImportAiClient } from './ai-import.client';
import { parseCsvTable } from './csv.util';
import { analyzeTable, extractFromAnalyzedSheet } from './sheet-analysis';
import { mergeExtracted } from './import.types';

/**
 * Parser de último recurso quando a LLM está configurada.
 * Ativa para arquivos de texto que não parecem CSV/XML/XLSX clássicos,
 * ou CSV muito bagunçado que os parsers estruturados recusaram via detect.
 *
 * Hoje: tenta tabularizar + classificar; se a LLM estiver on, o
 * AiSheetAssistant no ImportsService refina. Este parser só entra se
 * detect() for true — ou seja, IMPORT_AI_ENABLED + key.
 */
@Injectable()
export class AiImportParser implements ImportParser {
  constructor(private readonly ai: ImportAiClient) {}

  detect(file: ImportFile): boolean {
    if (!this.ai.isReady()) return false;
    if (/\.(xlsx?|xml)$/i.test(file.name)) return false;
    if (file.encoding === 'base64') return false;

    const head = file.content.slice(0, 1500).trimStart();
    if (head.startsWith('<')) return false;

    // Texto / CSV atípico: tem linhas mas poucos delimitadores clássicos
    const lines = head.split(/\n/).filter((l) => l.trim()).length;
    if (lines < 2) return false;

    const hasDelim =
      head.includes(',') || head.includes(';') || head.includes('\t');
    // Se já parece CSV normal, deixa o CsvImportParser (registrado antes) pegar.
    // Este parser só pega extensões .txt/.tsv/sem extensão ou conteúdo tabular fraco.
    if (/\.(csv)$/i.test(file.name) && hasDelim) return false;

    return /\.(txt|tsv)$/i.test(file.name) || (!hasDelim && lines >= 3);
  }

  async parse(file: ImportFile): Promise<ParserResult> {
    const preview = emptyPreview('text');
    const content =
      file.encoding === 'base64'
        ? Buffer.from(file.content, 'base64').toString('utf8')
        : file.content;

    // 1) Tenta como tabela mesmo assim
    const table = parseCsvTable(content);
    if (table.length >= 2) {
      const sheet = analyzeTable(table, file.name);
      // LLM refinement happens in ImportsService via AiSheetAssistant
      const extracted = extractFromAnalyzedSheet(sheet);
      const merged = mergeExtracted([extracted], 'text');
      merged.warnings.push(
        `${file.name}: interpretado com assistência de IA (quando configurada).`,
      );
      return { preview: merged, sheets: [sheet] };
    }

    // 2) Texto sem tabela — pede kind à LLM (columnMap vazio)
    const aiResult = await this.ai.parseUnstructuredText({
      fileName: file.name,
      textSample: content,
    });

    if (!aiResult || aiResult.kind === 'ambiguous') {
      preview.warnings.push(
        `${file.name}: a IA não conseguiu estruturar o arquivo. Exporte como CSV ou Excel.`,
      );
      return { preview, sheets: [] };
    }

    preview.warnings.push(
      `${file.name}: arquivo pouco estruturado — kind sugerido pela IA: ${aiResult.kind}. Prefira CSV/Excel para melhor resultado.`,
    );
    return { preview, sheets: [] };
  }
}
