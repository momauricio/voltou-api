import {
  BadRequestException,
  ConflictException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { parseBrMobileE164 } from '../common/phone.util';
import {
  ChangePasswordInput,
  ForgotPasswordInput,
  GoogleAuthInput,
  LoginInput,
  RegisterInput,
  VerifyEmailInput,
} from '../shared/schemas';
import { assertActiveCnpj, getCnpjStatus } from './cnpj.util';
import { getGoogleClientId, verifyGoogleIdToken } from './google-id-token';
import {
  createToken,
  hashPassword,
  hashToken,
  signAccessToken,
  slugify,
  verifyAccessToken,
  verifyPassword,
} from './crypto.util';

const OWNER_PHONE_MSG =
  'Informe um celular brasileiro com DDD (11 dígitos, nono dígito 9).';

type OwnerWithTenant = {
  id: string;
  tenantId: string;
  email: string;
  ownerName: string;
  role: string;
  passwordHash: string;
  emailVerifiedAt: Date | null;
  googleSub: string | null;
  tenant: { name: string; stores: { id: string; name: string }[] };
};

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

  health() {
    return { module: 'auth', status: 'ok' };
  }

  async cnpjStatus(cnpj: string) {
    try {
      return await getCnpjStatus(cnpj);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error
          ? error.message
          : 'Não foi possível validar o CNPJ agora. Tente novamente.',
      );
    }
  }

  async register(input: RegisterInput) {
    try {
      await assertActiveCnpj(input.cnpj);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'CNPJ inválido.',
      );
    }

    const existingEmail = await this.prisma.user.findUnique({
      where: { email: input.email },
    });
    if (existingEmail) {
      throw new ConflictException('Já existe uma conta com este email.');
    }

    const existingPhone = await this.prisma.user.findUnique({
      where: { ownerPhoneE164: input.ownerPhoneE164 },
    });
    if (existingPhone) {
      throw new ConflictException('Já existe uma conta com este WhatsApp.');
    }

    const existingCnpj = await this.prisma.tenant.findUnique({
      where: { cnpj: input.cnpj },
    });
    if (existingCnpj) {
      throw new ConflictException('Já existe uma conta com este CNPJ.');
    }

    const verifyToken = createToken();
    const tenant = await this.createOwnerTenant({
      ownerName: input.ownerName,
      storeName: input.storeName,
      cnpj: input.cnpj,
      email: input.email,
      ownerPhoneE164: input.ownerPhoneE164,
      passwordHash: hashPassword(input.password),
      googleSub: null,
      emailVerifiedAt: null,
      emailVerifyToken: hashToken(verifyToken),
    });

    const verifyUrl = `${process.env.WEB_URL ?? 'http://localhost:3000'}/verificar-email?token=${verifyToken}&email=${encodeURIComponent(input.email)}`;
    await this.email.sendVerifyEmail({
      to: input.email,
      ownerName: input.ownerName,
      storeName: input.storeName,
      verifyUrl,
    });

    return {
      message:
        'Conta criada. Confirme o email para ativar o acesso da loja.',
      email: input.email,
      tenantId: tenant.id,
      requiresEmailVerification: true as const,
      ...(process.env.NODE_ENV !== 'production'
        ? { devVerifyUrl: verifyUrl }
        : {}),
    };
  }

  async login(input: LoginInput) {
    const raw = (input.identifier ?? input.email ?? '').trim();
    const user = await this.findOwnerForLogin(raw);

    if (!user || !verifyPassword(input.password, user.passwordHash)) {
      throw new UnauthorizedException('Email ou senha inválidos.');
    }

    if (!user.emailVerifiedAt) {
      throw new UnauthorizedException(
        'Confirme seu email antes de entrar. Verifique a caixa de entrada.',
      );
    }

    return this.issueSession(user);
  }

  async googleLogin(input: GoogleAuthInput) {
    if (!getGoogleClientId()) {
      throw new ServiceUnavailableException(
        'Google login não configurado — defina GOOGLE_CLIENT_ID com o Client ID OAuth do Google (não invente um valor).',
      );
    }

    const claims = await verifyGoogleIdToken(input.idToken);

    const include = { tenant: { include: { stores: true } } } as const;
    let user = await this.prisma.user.findUnique({
      where: { googleSub: claims.sub },
      include,
    });

    if (!user) {
      user = await this.prisma.user.findUnique({
        where: { email: claims.email },
        include,
      });
      if (user) {
        if (user.googleSub && user.googleSub !== claims.sub) {
          throw new ConflictException(
            'Este email já está vinculado a outra conta Google.',
          );
        }
        user = await this.prisma.user.update({
          where: { id: user.id },
          data: {
            googleSub: claims.sub,
            emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
          },
          include,
        });
      }
    }

    if (user) {
      return this.issueSession(user);
    }

    const storeName = input.storeName?.trim();
    const cnpj = input.cnpj;
    const ownerPhoneE164 = parseBrMobileE164(
      input.ownerPhone ?? input.ownerPhoneE164 ?? '',
    );
    const ownerName =
      input.ownerName?.trim() ||
      claims.name?.trim() ||
      claims.email.split('@')[0];

    if (!storeName || storeName.length < 2) {
      throw new BadRequestException(
        'Informe o nome da loja para criar a conta.',
      );
    }
    if (!cnpj) {
      throw new BadRequestException('Informe o CNPJ da loja.');
    }
    if (!ownerPhoneE164) {
      throw new BadRequestException(OWNER_PHONE_MSG);
    }
    if (!ownerName || ownerName.length < 2) {
      throw new BadRequestException('Informe o nome do lojista.');
    }

    try {
      await assertActiveCnpj(cnpj);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'CNPJ inválido.',
      );
    }

    const existingPhone = await this.prisma.user.findUnique({
      where: { ownerPhoneE164 },
    });
    if (existingPhone) {
      throw new ConflictException('Já existe uma conta com este WhatsApp.');
    }

    const existingCnpj = await this.prisma.tenant.findUnique({
      where: { cnpj },
    });
    if (existingCnpj) {
      throw new ConflictException('Já existe uma conta com este CNPJ.');
    }

    const tenant = await this.createOwnerTenant({
      ownerName,
      storeName,
      cnpj,
      email: claims.email,
      ownerPhoneE164,
      passwordHash: hashPassword(createToken()),
      googleSub: claims.sub,
      emailVerifiedAt: new Date(),
      emailVerifyToken: null,
    });

    const created = tenant.users[0];
    return this.issueSession({
      id: created.id,
      tenantId: tenant.id,
      email: created.email,
      ownerName: created.ownerName,
      role: created.role ?? 'owner',
      passwordHash: created.passwordHash,
      emailVerifiedAt: created.emailVerifiedAt ?? new Date(),
      googleSub: created.googleSub ?? claims.sub,
      tenant: { name: tenant.name, stores: tenant.stores },
    });
  }

  async verifyEmail(input: VerifyEmailInput) {
    const tokenHash = hashToken(input.token);
    const user = await this.prisma.user.findFirst({
      where: { emailVerifyToken: tokenHash },
    });

    if (!user) {
      throw new BadRequestException('Link inválido ou já utilizado.');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerifiedAt: new Date(),
        emailVerifyToken: null,
      },
    });

    return { message: 'Email confirmado. Você já pode entrar.' };
  }

  async forgotPassword(input: ForgotPasswordInput) {
    const user = await this.prisma.user.findUnique({
      where: { email: input.email },
    });

    // Always same response (no email enumeration).
    const message =
      'Se o email estiver cadastrado, enviamos um link para redefinir a senha.';

    if (!user) {
      return { message };
    }

    const token = createToken();
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordResetToken: hashToken(token),
        passwordResetExpires: new Date(Date.now() + 1000 * 60 * 60),
      },
    });

    const resetUrl = `${process.env.WEB_URL ?? 'http://localhost:3000'}/redefinir-senha?token=${token}`;
    await this.email.sendPasswordReset({
      to: input.email,
      resetUrl,
    });

    return {
      message,
      ...(process.env.NODE_ENV !== 'production'
        ? { devResetUrl: resetUrl }
        : {}),
    };
  }

  async me(accessToken: string) {
    const payload = verifyAccessToken(accessToken);
    if (!payload) {
      throw new UnauthorizedException('Sessão inválida ou expirada.');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: { tenant: { include: { stores: true } } },
    });
    if (!user || user.tenantId !== payload.tenantId) {
      throw new UnauthorizedException('Sessão inválida.');
    }

    return {
      user: this.publicUser(user),
    };
  }

  async changePassword(accessToken: string, input: ChangePasswordInput) {
    const payload = verifyAccessToken(accessToken);
    if (!payload) {
      throw new UnauthorizedException('Sessão inválida ou expirada.');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
    });
    if (!user) throw new UnauthorizedException('Sessão inválida.');

    if (!verifyPassword(input.currentPassword, user.passwordHash)) {
      throw new BadRequestException('Senha atual incorreta.');
    }
    if (input.currentPassword === input.newPassword) {
      throw new BadRequestException(
        'A nova senha deve ser diferente da atual.',
      );
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: hashPassword(input.newPassword) },
    });

    return { message: 'Senha atualizada com sucesso.' };
  }

  private async findOwnerForLogin(raw: string): Promise<OwnerWithTenant | null> {
    const include = { tenant: { include: { stores: true } } } as const;
    if (raw.includes('@')) {
      return this.prisma.user.findUnique({
        where: { email: raw.toLowerCase() },
        include,
      });
    }
    const phone = parseBrMobileE164(raw);
    if (!phone) return null;
    return this.prisma.user.findUnique({
      where: { ownerPhoneE164: phone },
      include,
    });
  }

  private issueSession(user: OwnerWithTenant) {
    const accessToken = signAccessToken({
      sub: user.id,
      tenantId: user.tenantId,
      email: user.email,
      role: user.role,
    });

    return {
      accessToken,
      user: this.publicUser(user),
    };
  }

  private publicUser(user: OwnerWithTenant) {
    const store = user.tenant.stores[0];
    return {
      id: user.id,
      email: user.email,
      ownerName: user.ownerName,
      storeName: store?.name ?? user.tenant.name,
      tenantId: user.tenantId,
      storeId: store?.id ?? null,
      role: user.role,
    };
  }

  private async createOwnerTenant(input: {
    ownerName: string;
    storeName: string;
    cnpj: string;
    email: string;
    ownerPhoneE164: string;
    passwordHash: string;
    googleSub: string | null;
    emailVerifiedAt: Date | null;
    emailVerifyToken: string | null;
  }) {
    const baseSlug = slugify(input.storeName) || `loja-${input.cnpj.slice(-4)}`;
    let slug = baseSlug;
    let i = 1;
    while (await this.prisma.tenant.findUnique({ where: { slug } })) {
      slug = `${baseSlug}-${i++}`;
    }

    const userData: Record<string, unknown> = {
      ownerName: input.ownerName,
      email: input.email,
      passwordHash: input.passwordHash,
      ownerPhoneE164: input.ownerPhoneE164,
      role: 'owner',
      emailVerifyToken: input.emailVerifyToken,
      emailVerifiedAt: input.emailVerifiedAt,
    };
    if (input.googleSub) {
      userData.googleSub = input.googleSub;
    }

    return this.prisma.tenant.create({
      data: {
        name: input.storeName,
        slug,
        cnpj: input.cnpj,
        stores: {
          create: {
            name: input.storeName,
            slug: 'principal',
          },
        },
        users: {
          create: userData as {
            ownerName: string;
            email: string;
            passwordHash: string;
            ownerPhoneE164: string;
            role: string;
            emailVerifyToken: string | null;
            emailVerifiedAt: Date | null;
            googleSub?: string;
          },
        },
      },
      include: { users: true, stores: true },
    });
  }
}
