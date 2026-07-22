import { Injectable, Logger } from '@nestjs/common';
import { getImportAiConfig, type ImportAiConfig } from './ai-import.config';
import type { Field, SheetKind } from './sheet-analysis';
import { ALL_FIELDS } from './sheet-analysis';

/** Contrato estável que a LLM deve devolver (JSON). */
export type AiSheetMappingResult = {
  kind: SheetKind;
  confidence: number;
  /** field → índice da coluna (0-based) */
  columnMap: Partial<Record<Field, number>>;
  reasoning?: string;
};

export type AiSheetMappingInput = {
  sheetName: string;
  headers: string[];
  /** Amostra de linhas (já truncada) */
  sampleRows: string[][];
  heuristicKind: SheetKind;
  heuristicConfidence: number;
};

/**
 * Cliente OpenAI-compatible (Chat Completions + JSON).
 * Padrão: Grok / xAI (`https://api.x.ai/v1`).
 * Troque baseUrl/model/key se mudar de provedor.
 */
@Injectable()
export class ImportAiClient {
  private readonly logger = new Logger(ImportAiClient.name);

  getConfig(): ImportAiConfig {
    return getImportAiConfig();
  }

  isReady(): boolean {
    const c = this.getConfig();
    return c.enabled && Boolean(c.apiKey);
  }

  /**
   * Classifica o tipo da planilha e mapeia colunas.
   * Retorna null se LLM desligada, falhar ou resposta inválida
   * (caller mantém heurística).
   */
  async mapSheet(
    input: AiSheetMappingInput,
  ): Promise<AiSheetMappingResult | null> {
    const config = this.getConfig();
    if (!config.enabled || !config.apiKey) return null;

    const system = `Você é um assistente da Voltou (SaaS brasileiro de recompra via WhatsApp).
Analise uma planilha de lojista e devolva APENAS JSON válido com este formato:
{
  "kind": "customers" | "products" | "sales" | "ambiguous",
  "confidence": number entre 0 e 1,
  "columnMap": { "<campo>": <índice_coluna_0_based>, ... },
  "reasoning": "frase curta em pt-BR"
}

Campos permitidos em columnMap: ${ALL_FIELDS.join(', ')}.
Regras:
- customers = lista de clientes (telefone/WhatsApp importante)
- products = catálogo (nome + preço)
- sales = relatório com cliente E produto na mesma linha
- ambiguous só se realmente impossível distinguir
- Índices de coluna começam em 0 e devem existir nos headers
- Não invente colunas; omita campos sem match claro`;

    const user = JSON.stringify(
      {
        sheetName: input.sheetName,
        headers: input.headers,
        sampleRows: input.sampleRows.slice(0, 8),
        heuristic: {
          kind: input.heuristicKind,
          confidence: input.heuristicConfidence,
        },
      },
      null,
      0,
    );

    try {
      const raw = await this.chatJson(config, system, user);
      return this.validateResult(raw, input.headers.length);
    } catch (err) {
      this.logger.warn(
        `LLM mapSheet falhou: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  /**
   * Interpreta texto livre / planilha sem estrutura (fase futura).
   * Hoje devolve null se não configurado; a implementação JSON já está pronta.
   */
  async parseUnstructuredText(input: {
    fileName: string;
    textSample: string;
  }): Promise<AiSheetMappingResult | null> {
    const config = this.getConfig();
    if (!config.enabled || !config.apiKey) return null;

    const system = `Extraia da amostra se o conteúdo parece clientes, produtos ou vendas.
Devolva JSON: { "kind", "confidence", "columnMap": {}, "reasoning" }.
Se não houver tabela clara, kind=ambiguous e columnMap vazio.`;

    try {
      const raw = await this.chatJson(
        config,
        system,
        JSON.stringify({
          fileName: input.fileName,
          sample: input.textSample.slice(0, 4000),
        }),
      );
      return this.validateResult(raw, 0);
    } catch (err) {
      this.logger.warn(
        `LLM parseUnstructured falhou: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  private async chatJson(
    config: ImportAiConfig,
    system: string,
    user: string,
  ): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      const res = await fetch(`${config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: config.model,
          temperature: 0,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
      }

      const data = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new Error('Resposta LLM vazia');
      return JSON.parse(content) as unknown;
    } finally {
      clearTimeout(timer);
    }
  }

  private validateResult(
    raw: unknown,
    headerCount: number,
  ): AiSheetMappingResult | null {
    if (!raw || typeof raw !== 'object') return null;
    const obj = raw as Record<string, unknown>;
    const kind = obj.kind;
    if (
      kind !== 'customers' &&
      kind !== 'products' &&
      kind !== 'sales' &&
      kind !== 'ambiguous'
    ) {
      return null;
    }

    let confidence = Number(obj.confidence);
    if (!Number.isFinite(confidence)) confidence = 0.5;
    confidence = Math.max(0, Math.min(1, confidence));

    const columnMap: Partial<Record<Field, number>> = {};
    const rawMap =
      obj.columnMap && typeof obj.columnMap === 'object'
        ? (obj.columnMap as Record<string, unknown>)
        : {};

    for (const field of ALL_FIELDS) {
      const idx = rawMap[field];
      if (typeof idx === 'number' && Number.isInteger(idx) && idx >= 0) {
        if (headerCount === 0 || idx < headerCount) {
          columnMap[field] = idx;
        }
      }
    }

    return {
      kind,
      confidence,
      columnMap,
      reasoning:
        typeof obj.reasoning === 'string' ? obj.reasoning.slice(0, 300) : undefined,
    };
  }
}
