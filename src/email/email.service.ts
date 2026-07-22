import { Injectable, Logger } from '@nestjs/common';
import { Resend } from 'resend';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly resend: Resend | null;
  private readonly from: string;

  constructor() {
    const apiKey = process.env.RESEND_API_KEY;
    this.from =
      process.env.RESEND_FROM ?? 'Voltou. <onboarding@resend.dev>';
    this.resend = apiKey ? new Resend(apiKey) : null;
    if (!apiKey) {
      this.logger.warn(
        'RESEND_API_KEY ausente — emails serão só logados no console.',
      );
    }
  }

  async sendVerifyEmail(params: {
    to: string;
    ownerName: string;
    storeName: string;
    verifyUrl: string;
  }) {
    const subject = 'Confirme seu email no Voltou.';
    const text = `Olá ${params.ownerName},\n\nConfirme o email para ativar ${params.storeName} no Voltou.:\n${params.verifyUrl}\n`;
    const html = this.wrapHtml(`
      <p style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:24px;color:#5a6b62;">
        Olá <strong style="color:#1a2e24;">${escapeHtml(params.ownerName)}</strong>,
        confirme o email para ativar <strong style="color:#1a2e24;">${escapeHtml(params.storeName)}</strong> no Voltou.
      </p>
      <p style="text-align:center;padding:24px 0;">
        <a href="${escapeAttr(params.verifyUrl)}"
           style="display:inline-block;background-color:#2f9e5f;color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:700;text-decoration:none;padding:14px 28px;border-radius:10px;">
          Confirmar email
        </a>
      </p>
      <p style="font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:20px;color:#8a968f;">
        Ou abra: ${escapeHtml(params.verifyUrl)}
      </p>
    `);

    await this.send({
      to: params.to,
      subject,
      text,
      html,
      tags: [
        { name: 'type', value: 'verify-email' },
        { name: 'product', value: 'voltou' },
      ],
    });
  }

  async sendPasswordReset(params: { to: string; resetUrl: string }) {
    const subject = 'Redefina sua senha no Voltou.';
    const text = `Redefina sua senha (válido por 1 hora):\n${params.resetUrl}\n\nSe você não pediu isso, ignore este email.`;
    const html = this.wrapHtml(`
      <p style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:24px;color:#5a6b62;">
        Recebemos um pedido para redefinir a senha da sua conta no Voltou. O link expira em 1 hora.
      </p>
      <p style="text-align:center;padding:24px 0;">
        <a href="${escapeAttr(params.resetUrl)}"
           style="display:inline-block;background-color:#2f9e5f;color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:700;text-decoration:none;padding:14px 28px;border-radius:10px;">
          Redefinir senha
        </a>
      </p>
      <p style="font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:20px;color:#8a968f;">
        Se você não pediu isso, ignore este email.
      </p>
    `);

    await this.send({
      to: params.to,
      subject,
      text,
      html,
      tags: [
        { name: 'type', value: 'password-reset' },
        { name: 'product', value: 'voltou' },
      ],
    });
  }

  async sendPaymentReceived(params: {
    to: string;
    storeName: string;
    customerName: string;
    productName: string;
    amountCents: number;
    commissionCents: number;
  }) {
    const valor = (params.amountCents / 100).toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    });
    const comissao = (params.commissionCents / 100).toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    });
    const subject = `Pagamento recebido: ${params.productName} · ${valor}`;
    const text = `Boa notícia! ${params.customerName} pagou ${params.productName} (${valor}) via link da Voltou.\nComissão Voltou: ${comissao}.\nLoja: ${params.storeName}.`;
    const html = this.wrapHtml(`
      <p style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:24px;color:#5a6b62;">
        Boa notícia! <strong style="color:#1a2e24;">${escapeHtml(params.customerName)}</strong>
        pagou <strong style="color:#1a2e24;">${escapeHtml(params.productName)}</strong>
        (<strong style="color:#2f9e5f;">${escapeHtml(valor)}</strong>) via link da Voltou.
      </p>
      <p style="font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:20px;color:#8a968f;">
        Comissão Voltou: ${escapeHtml(comissao)} · Loja: ${escapeHtml(params.storeName)}
      </p>
    `);

    await this.send({
      to: params.to,
      subject,
      text,
      html,
      tags: [
        { name: 'type', value: 'payment-received' },
        { name: 'product', value: 'voltou' },
      ],
    });
  }

  private wrapHtml(inner: string): string {
    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f7f6f2;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f7f6f2"><tr><td align="center" style="padding:40px 16px;">
<table width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="max-width:600px;width:100%;border-radius:12px;">
<tr><td style="padding:32px 32px 8px;font-family:Arial,Helvetica,sans-serif;font-size:22px;line-height:28px;color:#1a2e24;font-weight:700;">Voltou<span style="color:#2f9e5f;">.</span></td></tr>
<tr><td style="padding:8px 32px 32px;">${inner}</td></tr>
</table></td></tr></table></body></html>`;
  }

  private async send(params: {
    to: string;
    subject: string;
    text: string;
    html: string;
    tags: { name: string; value: string }[];
  }) {
    if (!this.resend) {
      this.logger.log(`[email:dev] to=${params.to} subject=${params.subject}`);
      this.logger.log(params.text);
      return;
    }

    const { data, error } = await this.resend.emails.send({
      from: this.from,
      to: [params.to],
      subject: params.subject,
      text: params.text,
      html: params.html,
      tags: params.tags,
    });

    if (error) {
      this.logger.error(`Resend error: ${error.message}`);
      throw new Error('Falha ao enviar email. Tente novamente.');
    }

    this.logger.log(`Email enviado via Resend id=${data?.id}`);
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/'/g, '&#39;');
}
