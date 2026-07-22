/**
 * Configuração da LLM para importação de planilhas.
 *
 * Provedor padrão: **Grok (xAI)** — API compatível com Chat Completions.
 *
 * Para ativar:
 *   IMPORT_AI_ENABLED=1
 *   IMPORT_AI_API_KEY=xai-...     (ou XAI_API_KEY)
 *   IMPORT_AI_BASE_URL=https://api.x.ai/v1   (padrão)
 *   IMPORT_AI_MODEL=grok-3-mini              (padrão; troque se quiser)
 *
 * Sem chave / enabled=0: heurísticas locais continuam sozinhas.
 */

export type ImportAiConfig = {
  enabled: boolean;
  apiKey: string | null;
  baseUrl: string;
  model: string;
  /** Timeout em ms para cada chamada */
  timeoutMs: number;
  /** Só chama LLM quando confiança heurística < este limiar */
  confidenceThreshold: number;
};

export function getImportAiConfig(): ImportAiConfig {
  const apiKey =
    process.env.IMPORT_AI_API_KEY?.trim() ||
    process.env.XAI_API_KEY?.trim() ||
    process.env.OPENAI_API_KEY?.trim() ||
    null;
  const enabledFlag = process.env.IMPORT_AI_ENABLED?.trim();
  // Exige flag explícita + chave — evita chamadas acidentais a API paga
  const enabled =
    (enabledFlag === '1' || enabledFlag === 'true') && Boolean(apiKey);

  return {
    enabled,
    apiKey,
    baseUrl: (
      process.env.IMPORT_AI_BASE_URL?.trim() || 'https://api.x.ai/v1'
    ).replace(/\/$/, ''),
    // Modelo leve para classificação JSON; troque para grok-4.5 se precisar
    model: process.env.IMPORT_AI_MODEL?.trim() || 'grok-3-mini',
    timeoutMs: Number(process.env.IMPORT_AI_TIMEOUT_MS ?? 25_000) || 25_000,
    confidenceThreshold: Number(
      process.env.IMPORT_AI_CONFIDENCE_THRESHOLD ?? 0.65,
    ) || 0.65,
  };
}
