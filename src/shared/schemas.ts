import { z } from 'zod';

export const tenantIdSchema = z.string().uuid();
export const storeIdSchema = z.string().uuid();

export const registerSchema = z.object({
  ownerName: z.string().trim().min(2).max(120),
  storeName: z.string().trim().min(2).max(120),
  cnpj: z
    .string()
    .transform((v) => v.replace(/\D/g, ''))
    .refine((v) => v.length === 14, 'CNPJ deve ter 14 dígitos'),
  email: z.string().trim().email().max(255).transform((v) => v.toLowerCase()),
  password: z.string().min(8).max(128),
});

export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: z.string().trim().email().transform((v) => v.toLowerCase()),
  password: z.string().min(1).max(128),
});

export type LoginInput = z.infer<typeof loginSchema>;

export const forgotPasswordSchema = z.object({
  email: z.string().trim().email().transform((v) => v.toLowerCase()),
});

export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(8).max(128),
});

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const verifyEmailSchema = z.object({
  token: z.string().min(16).max(200),
});

export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;

export const createCustomerSchema = z.object({
  tenantId: tenantIdSchema,
  storeId: storeIdSchema,
  displayName: z.string().trim().min(2).max(200),
  phone: z.string().min(8).max(30),
  notes: z.string().max(2000).optional(),
  interestProductId: z.string().uuid().optional(),
  interestProductName: z.string().trim().min(1).max(200).optional(),
  interestNotes: z.string().max(1000).optional(),
});

export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;

export const createInterestSchema = z.object({
  tenantId: tenantIdSchema,
  storeId: storeIdSchema,
  customerId: z.string().uuid(),
  productId: z.string().uuid().optional(),
  productName: z.string().trim().min(1).max(200).optional(),
  productPriceCents: z.number().int().nonnegative().optional(),
  source: z
    .enum(['walk_in', 'whatsapp', 'import', 'ai', 'web'])
    .default('walk_in'),
  notes: z.string().max(1000).optional(),
});

export type CreateInterestInput = z.infer<typeof createInterestSchema>;

export const createCheckoutSchema = z.object({
  tenantId: tenantIdSchema,
  storeId: storeIdSchema,
  customerId: z.string().uuid(),
  productId: z.string().uuid(),
  productName: z.string().trim().min(1).max(200).optional(),
  amountCents: z.number().int().positive().optional(),
  interestId: z.string().uuid().optional(),
  createdBy: z.enum(['human', 'ai']).default('human'),
  expiresInHours: z.number().int().positive().max(168).default(48),
  addons: z
    .array(
      z.object({
        productId: z.string().uuid(),
        discountBps: z.number().int().min(0).max(9000),
        selectedByDefault: z.boolean().optional().default(false),
      }),
    )
    .max(5)
    .optional()
    .default([]),
  discountBps: z.number().int().min(0).max(9000).optional(),
});

export type CreateCheckoutInput = z.infer<typeof createCheckoutSchema>;

export const createProductSchema = z.object({
  tenantId: tenantIdSchema,
  storeId: storeIdSchema,
  name: z.string().min(1).max(200),
  sku: z.string().max(64).optional(),
  category: z.string().max(120).optional(),
  priceCents: z.number().int().nonnegative(),
  costCents: z.number().int().nonnegative().optional(),
  maxDiscountBps: z.number().int().min(0).max(10000).optional(),
  availability: z.enum(['available', 'unavailable']).optional(),
  sellableByAi: z.boolean().optional(),
  stock: z.number().int().nonnegative().default(0),
  active: z.boolean().default(true),
});

export type CreateProductInput = z.infer<typeof createProductSchema>;

export const updateProductSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  sku: z.string().max(64).nullable().optional(),
  category: z.string().max(120).nullable().optional(),
  priceCents: z.number().int().nonnegative().optional(),
  costCents: z.number().int().nonnegative().nullable().optional(),
  maxDiscountBps: z.number().int().min(0).max(10000).nullable().optional(),
  availability: z.enum(['available', 'unavailable']).optional(),
  sellableByAi: z.boolean().optional(),
  stock: z.number().int().nonnegative().optional(),
  active: z.boolean().optional(),
});

export type UpdateProductInput = z.infer<typeof updateProductSchema>;

export const createSaleSchema = z.object({
  tenantId: tenantIdSchema,
  storeId: storeIdSchema,
  customerId: z.string().uuid(),
  productId: z.string().uuid(),
  amountCents: z.number().int().positive(),
  currency: z.string().length(3).default('BRL'),
  source: z
    .enum(['in_store', 'checkout_link', 'ai', 'import'])
    .default('in_store'),
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

export const registerContactSchema = z.object({
  occurredAt: z.string().datetime().optional(),
  channel: z.enum(['call', 'whatsapp', 'other']).optional(),
  note: z.string().trim().max(2000).optional(),
});

export type RegisterContactInput = z.infer<typeof registerContactSchema>;
