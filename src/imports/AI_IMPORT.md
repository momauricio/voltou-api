# Importação com LLM — padrão: Grok (xAI)
#
# Com a chave configurada, planilhas ambíguas / baixa confiança são
# reclassificadas automaticamente (tipo + mapeamento de colunas).
# Sem chave: só heurísticas locais (comportamento atual).
#
# API OpenAI-compatible: https://api.x.ai/v1/chat/completions
# Chave em: https://console.x.ai/

IMPORT_AI_ENABLED=0
# IMPORT_AI_API_KEY=xai-...
# ou: XAI_API_KEY=xai-...
IMPORT_AI_BASE_URL=https://api.x.ai/v1
IMPORT_AI_MODEL=grok-3-mini
# IMPORT_AI_TIMEOUT_MS=25000
# IMPORT_AI_CONFIDENCE_THRESHOLD=0.65
#
# Modelos maiores (se precisar): grok-4.5, grok-4.3, etc.
