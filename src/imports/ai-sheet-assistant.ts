import { Injectable, Logger } from '@nestjs/common';
import { ImportAiClient } from './ai-import.client';
import {
  AnalyzedSheet,
  applyColumnOverrides,
  extractFromAnalyzedSheet,
} from './sheet-analysis';
import type { ExtractedPreview } from './sheet-analysis';

/**
 * Aplica a LLM em planilhas ambíguas / baixa confiança.
 * Se a LLM estiver desligada, devolve o sheet heurístico sem alteração.
 */
@Injectable()
export class AiSheetAssistant {
  private readonly logger = new Logger(AiSheetAssistant.name);

  constructor(private readonly ai: ImportAiClient) {}

  isReady(): boolean {
    return this.ai.isReady();
  }

  /**
   * Refina um sheet analisado heuristicamente.
   * Só chama a LLM quando confiança < limiar ou kind=ambiguous.
   */
  async refineSheet(sheet: AnalyzedSheet): Promise<AnalyzedSheet> {
    const config = this.ai.getConfig();
    if (!this.ai.isReady()) return sheet;

    const needsAi =
      sheet.meta.kind === 'ambiguous' ||
      sheet.meta.confidence < config.confidenceThreshold;

    if (!needsAi) return sheet;

    const result = await this.ai.mapSheet({
      sheetName: sheet.meta.name,
      headers: sheet.headers,
      sampleRows: sheet.meta.sampleRows,
      heuristicKind: sheet.meta.kind,
      heuristicConfidence: sheet.meta.confidence,
    });

    if (!result || result.kind === 'ambiguous') {
      if (result?.reasoning) {
        this.logger.debug(`LLM manteve ambíguo: ${result.reasoning}`);
      }
      return sheet;
    }

    const refined = applyColumnOverrides(
      sheet,
      result.columnMap,
      result.kind,
    );
    refined.meta.confidence = Math.max(result.confidence, 0.7);
    refined.meta.reasons = [
      ...(result.reasoning ? [`IA: ${result.reasoning}`] : ['refinado por IA']),
      ...sheet.meta.reasons.slice(0, 3),
    ];

    return refined;
  }

  async refineSheets(sheets: AnalyzedSheet[]): Promise<{
    sheets: AnalyzedSheet[];
    extracted: ExtractedPreview[];
    usedAi: boolean;
  }> {
    if (!this.ai.isReady() || sheets.length === 0) {
      return {
        sheets,
        extracted: sheets.map(extractFromAnalyzedSheet),
        usedAi: false,
      };
    }

    let usedAi = false;
    const next: AnalyzedSheet[] = [];
    for (const sheet of sheets) {
      const before = sheet.meta.kind;
      const refined = await this.refineSheet(sheet);
      if (refined.meta.kind !== before || refined.meta.confidence > sheet.meta.confidence) {
        usedAi = true;
      }
      // Mark usedAi if reasons mention IA
      if (refined.meta.reasons.some((r) => r.startsWith('IA:') || r.includes('IA'))) {
        usedAi = true;
      }
      next.push(refined);
    }

    return {
      sheets: next,
      extracted: next.map(extractFromAnalyzedSheet),
      usedAi,
    };
  }
}
