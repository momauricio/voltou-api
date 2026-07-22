import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import {
  ChangePasswordInput,
  ForgotPasswordInput,
  LoginInput,
  RegisterInput,
  VerifyEmailInput,
} from '../shared/schemas';
import { assertActiveCnpj } from './cnpj.util';
import {
  createToken,
  hashPassword,
  hashToken,
  signAccessToken,
  slugify,
  verifyAccessToken,
  verifyPassword,
} from './crypto.util';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

  health() {
    return { module: 'auth', status: 'ok' };
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

    const existingCnpj = await this.prisma.tenant.findUnique({
      where: { cnpj: input.cnpj },
    });
    if (existingCnpj) {
      throw new ConflictException('Já existe uma conta com este CNPJ.');
    }

    const baseSlug = slugify(input.storeName) || `loja-${input.cnpj.slice(-4)}`;
    let slug = baseSlug;
    let i = 1;
    while (await this.prisma.tenant.findUnique({ where: { slug } })) {
      slug = `${baseSlug}-${i++}`;
    }

    const verifyToken = createToken();
    const passwordHash = hashPassword(input.password);

    const tenant = await this.prisma.tenant.create({
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
          create: {
            ownerName: input.ownerName,
            email: input.email,
            passwordHash,
            role: 'owner',
            emailVerifyToken: hashToken(verifyToken),
          },
        },
      },
      include: { users: true, stores: true },
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
    const user = await this.prisma.user.findUnique({
      where: { email: input.email },
      include: { tenant: { include: { stores: true } } },
    });

    if (!user || !verifyPassword(input.password, user.passwordHash)) {
      throw new UnauthorizedException('Email ou senha inválidos.');
    }

    if (!user.emailVerifiedAt) {
      throw new UnauthorizedException(
        'Confirme seu email antes de entrar. Verifique a caixa de entrada.',
      );
    }

    const store = user.tenant.stores[0];
    const storeName = store?.name ?? user.tenant.name;

    const accessToken = signAccessToken({
      sub: user.id,
      tenantId: user.tenantId,
      email: user.email,
      role: user.role,
    });

    return {
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        ownerName: user.ownerName,
        storeName,
        tenantId: user.tenantId,
        storeId: store?.id ?? null,
      },
    };
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

    const store = user.tenant.stores[0];
    return {
      user: {
        id: user.id,
        email: user.email,
        ownerName: user.ownerName,
        storeName: store?.name ?? user.tenant.name,
        tenantId: user.tenantId,
        storeId: store?.id ?? null,
      },
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
}
