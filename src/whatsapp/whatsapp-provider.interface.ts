export interface SendMessageParams {
  tenantId: string;
  storeId: string;
  to: string;
  body: string;
  templateId?: string;
}

export interface WhatsAppProvider {
  sendMessage(params: SendMessageParams): Promise<{ messageId: string }>;
  verifyWebhook(payload: unknown, signature: string): boolean;
}
