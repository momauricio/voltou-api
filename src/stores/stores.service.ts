import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type CheckoutBrandingInput = {
  logoUrl?: string | null;
  primaryColor?: string | null;
  secondaryColor?: string | null;
  fontFamily?: string | null;
  message?: string | null;
};

export const STORE_RULES_TITLE = 'store-rules';

export type StoreRules = {
  sobreNegocio?: string;
  personalidade?: string;
  instrucoesExtras?: string;
  horaInicio?: string;
  horaFim?: string;
  diasAtivos?: string[];
  followUpDias?: string;
  descontoPadrao?: string;
  margemMaxima?: string;
  maxDescontoUmProduto?: string;
  maxDescontoDoisOuMais?: string;
  aniversario?: boolean;
  cupons?: { id: string; codigo: string; desconto: string; validade: string }[];
};

@Injectable()
export class StoresService {
  constructor(private readonly prisma: PrismaService) {}

  health() {
    return { module: 'stores', status: 'ok' };
  }

  async getRules(
    tenantId: string,
    storeId: string,
  ): Promise<{ rules: StoreRules | null; updatedAt: string | null }> {
    const row = await this.prisma.storeKnowledge.findFirst({
      where: { tenantId, storeId, title: STORE_RULES_TITLE },
    });
    if (!row) return { rules: null, updatedAt: null };
    try {
      return {
        rules: JSON.parse(row.content) as StoreRules,
        updatedAt: row.updatedAt.toISOString(),
      };
    } catch {
      return { rules: null, updatedAt: null };
    }
  }

  async saveRules(tenantId: string, storeId: string, rules: StoreRules) {
    const store = await this.prisma.store.findFirst({
      where: { id: storeId, tenantId },
    });
    if (!store) throw new NotFoundException('Loja não encontrada.');

    const existing = await this.prisma.storeKnowledge.findFirst({
      where: { tenantId, storeId, title: STORE_RULES_TITLE },
    });
    const content = JSON.stringify(rules);
    const row = existing
      ? await this.prisma.storeKnowledge.update({
          where: { id: existing.id },
          data: { content },
        })
      : await this.prisma.storeKnowledge.create({
          data: { tenantId, storeId, title: STORE_RULES_TITLE, content },
        });

    return { rules, updatedAt: row.updatedAt.toISOString() };
  }

  async getCheckoutBranding(tenantId: string, storeId: string) {
    const store = await this.prisma.store.findFirst({
      where: { id: storeId, tenantId },
    });
    if (!store) throw new NotFoundException('Loja não encontrada.');

    return {
      storeId: store.id,
      storeName: store.name,
      logoUrl: store.checkoutLogoUrl,
      primaryColor: store.checkoutPrimaryColor,
      secondaryColor: store.checkoutSecondaryColor,
      fontFamily: store.checkoutFontFamily ?? 'geist',
      message: store.checkoutMessage,
    };
  }

  async updateCheckoutBranding(
    tenantId: string,
    storeId: string,
    input: CheckoutBrandingInput,
  ) {
    const store = await this.prisma.store.findFirst({
      where: { id: storeId, tenantId },
    });
    if (!store) throw new NotFoundException('Loja não encontrada.');

    const updated = await this.prisma.store.update({
      where: { id: storeId },
      data: {
        ...(input.logoUrl !== undefined
          ? { checkoutLogoUrl: input.logoUrl }
          : {}),
        ...(input.primaryColor !== undefined
          ? { checkoutPrimaryColor: input.primaryColor }
          : {}),
        ...(input.secondaryColor !== undefined
          ? { checkoutSecondaryColor: input.secondaryColor }
          : {}),
        ...(input.fontFamily !== undefined
          ? { checkoutFontFamily: input.fontFamily }
          : {}),
        ...(input.message !== undefined
          ? { checkoutMessage: input.message }
          : {}),
      },
    });

    return {
      storeId: updated.id,
      storeName: updated.name,
      logoUrl: updated.checkoutLogoUrl,
      primaryColor: updated.checkoutPrimaryColor,
      secondaryColor: updated.checkoutSecondaryColor,
      fontFamily: updated.checkoutFontFamily ?? 'geist',
      message: updated.checkoutMessage,
    };
  }
}
