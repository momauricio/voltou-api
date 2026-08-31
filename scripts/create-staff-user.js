/**
 * Cria (ou atualiza) um usuário staff Voltou, separado da sessão do lojista.
 * Uso: node scripts/create-staff-user.js
 *
 * Variáveis opcionais: STAFF_EMAIL, STAFF_PASSWORD, STAFF_NAME
 */
const { PrismaClient } = require('@prisma/client');
const { randomBytes, scryptSync } = require('crypto');

const EMAIL = (process.env.STAFF_EMAIL ?? 'staff@voltou.com').toLowerCase();
const PASSWORD = process.env.STAFF_PASSWORD ?? 'staff1234';
const OWNER_NAME = process.env.STAFF_NAME ?? 'Equipe Voltou';
const TENANT_NAME = 'Voltou Staff';
const TENANT_SLUG = 'voltou-staff';
const TENANT_CNPJ = '00000000000191';

function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

async function main() {
  const prisma = new PrismaClient();
  const passwordHash = hashPassword(PASSWORD);

  let tenant = await prisma.tenant.findUnique({ where: { slug: TENANT_SLUG } });
  if (!tenant) {
    tenant = await prisma.tenant.create({
      data: {
        name: TENANT_NAME,
        slug: TENANT_SLUG,
        cnpj: TENANT_CNPJ,
      },
    });
  }

  const existing = await prisma.user.findUnique({ where: { email: EMAIL } });
  const user = existing
    ? await prisma.user.update({
        where: { id: existing.id },
        data: {
          tenantId: tenant.id,
          ownerName: OWNER_NAME,
          passwordHash,
          role: 'staff',
          emailVerifiedAt: new Date(),
          emailVerifyToken: null,
        },
      })
    : await prisma.user.create({
        data: {
          tenantId: tenant.id,
          ownerName: OWNER_NAME,
          email: EMAIL,
          passwordHash,
          role: 'staff',
          emailVerifiedAt: new Date(),
        },
      });

  console.log(
    JSON.stringify(
      {
        action: existing ? 'updated' : 'created',
        email: user.email,
        role: user.role,
        tenantId: user.tenantId,
      },
      null,
      2,
    ),
  );
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  process.exit(1);
});
