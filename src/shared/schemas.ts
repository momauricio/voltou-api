import { z } from 'zod';

export const tenantIdSchema = z.string().uuid();
export const storeIdSchema = z.string().uuid();

export const createProductSchema = z.object({
  tenantId: tenantIdSchema,
  storeId: storeIdSchema,
  name: z.string().min(1).max(200),
  sku: z.string().max(64).optional(),
  priceCents: z.number().int().nonnegative(),
  active: z.boolean().default(true),
});

export type CreateProductInput = z.infer<typeof createProductSchema>;

export const createCustomerSchema = z.object({
  tenantId: tenantIdSchema,
  storeId: storeIdSchema,
  displayName: z.string().min(1).max(200),
  // phone: hash/encrypt at rest (LGPD) — never store plaintext in logs
  phoneE164: z.string().regex(/^\+[1-9]\d{6,14}$/),
});

export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;

export const createSaleSchema = z.object({
  tenantId: tenantIdSchema,
  storeId: storeIdSchema,
  customerId: z.string().uuid(),
  productId: z.string().uuid(),
  amountCents: z.number().int().positive(),
  currency: z.string().length(3).default('BRL'),
});

export type CreateSaleInput = z.infer<typeof createSaleSchema>;

export const outreachMessageSchema = z.object({
  tenantId: tenantIdSchema,
  storeId: storeIdSchema,
  campaignId: z.string().uuid(),
  customerId: z.string().uuid(),
  channel: z.enum(['whatsapp']).default('whatsapp'),
  body: z.string().min(1).max(4096),
});

export type OutreachMessageInput = z.infer<typeof outreachMessageSchema>;
