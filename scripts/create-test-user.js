/**
 * Cria (ou atualiza) um usuário de teste já com email verificado.
 * Uso: node scripts/create-test-user.js
 */
const { PrismaClient } = require('@prisma/client');
const { randomBytes, scryptSync } = require('crypto');

const EMAIL = 'mauriciokima@gmail.com';
const PASSWORD = 'teste123';
const OWNER_NAME = 'Maurício Kima';
const STORE_NAME = 'Loja Maurício';
const CNPJ = '11222333000181';

function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function slugify(input) {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
}

async function main() {
  const prisma = new PrismaClient();
  const passwordHash = hashPassword(PASSWORD);

  const existing = await prisma.user.findUnique({
    where: { email: EMAIL },
    include: { tenant: { include: { stores: true } } },
  });

  if (existing) {
    await prisma.user.update({
      where: { id: existing.id },
      data: {
        passwordHash,
        emailVerifiedAt: new Date(),
        emailVerifyToken: null,
        ownerName: OWNER_NAME,
      },
    });
    console.log(
      JSON.stringify(
        {
          action: 'updated',
          email: EMAIL,
          tenantId: existing.tenantId,
          storeId: existing.tenant.stores[0]?.id ?? null,
        },
        null,
        2,
      ),
    );
    await prisma.$disconnect();
    return;
  }

  const slug = slugify(STORE_NAME) || 'loja-mauricio';
  const tenant = await prisma.tenant.create({
    data: {
      name: STORE_NAME,
      slug: `${slug}-${Date.now().toString(36)}`,
      cnpj: CNPJ,
      stores: {
        create: {
          name: STORE_NAME,
          slug: 'principal',
        },
      },
      users: {
        create: {
          ownerName: OWNER_NAME,
          email: EMAIL,
          passwordHash,
          role: 'owner',
          emailVerifiedAt: new Date(),
        },
      },
    },
    include: { stores: true, users: true },
  });

  console.log(
    JSON.stringify(
      {
        action: 'created',
        email: EMAIL,
        tenantId: tenant.id,
        storeId: tenant.stores[0]?.id ?? null,
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
