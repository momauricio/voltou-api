export interface SendMessageParams {
  tenantId: string;
  storeId: string;
  to: string;
  body: string;
  templateId?: string;
}

export type SendMessageResult = {
  messageId: string;
  chatId?: string;
};

export interface WhatsAppProvider {
  sendMessage(params: SendMessageParams): Promise<SendMessageResult>;
  verifyWebhook(payload: unknown, signature: string): boolean;
}
