/**
 * Cria (ou atualiza) um usuário staff Voltou, separado da sessão do lojista.
 * Uso: STAFF_EMAIL=... STAFF_PASSWORD=... node scripts/create-staff-user.js
 *
 * Variáveis: STAFF_EMAIL (obrigatório), STAFF_PASSWORD (obrigatório, mín. 8),
 * STAFF_NAME (opcional). Para promover um email que já é owner:
 * FORCE_STAFF_PROMOTE=1
 */
const { PrismaClient } = require('@prisma/client');
const { randomBytes, scryptSync } = require('crypto');

const EMAIL = (process.env.STAFF_EMAIL ?? '').trim().toLowerCase();
const PASSWORD = process.env.STAFF_PASSWORD ?? '';
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
  if (!EMAIL || !EMAIL.includes('@')) {
    console.error('Defina STAFF_EMAIL.');
    process.exit(1);
  }
  if (PASSWORD.length < 8) {
    console.error('Defina STAFF_PASSWORD com no mínimo 8 caracteres.');
    process.exit(1);
  }

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
  if (
    existing &&
    existing.role !== 'staff' &&
    process.env.FORCE_STAFF_PROMOTE !== '1'
  ) {
    console.error(
      `Email ${EMAIL} já existe com role=${existing.role}. Recuse promover um lojista sem FORCE_STAFF_PROMOTE=1.`,
    );
    await prisma.$disconnect();
    process.exit(1);
  }

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
