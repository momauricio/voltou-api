import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { Public } from './public.decorator';
import {
  cnpjStatusThrottle,
  loginThrottle,
  registerThrottle,
} from '../security/rate-limits';
import {
  changePasswordSchema,
  forgotPasswordSchema,
  googleAuthSchema,
  loginSchema,
  registerSchema,
  verifyEmailSchema,
} from '../shared/schemas';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Get('health')
  health() {
    return this.authService.health();
  }

  @Get('me')
  me(@Headers('authorization') authorization?: string) {
    const token = authorization?.replace(/^Bearer\s+/i, '').trim();
    if (!token) {
      throw new UnauthorizedException('Token ausente.');
    }
    return this.authService.me(token);
  }

  @Public()
  @Throttle(registerThrottle)
  @Post('register')
  register(@Body() body: unknown) {
    const parsed = registerSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.issues.map((i) => i.message).join(', '),
      );
    }
    return this.authService.register(parsed.data);
  }

  @Public()
  @Throttle(cnpjStatusThrottle)
  @Get('cnpj-status')
  cnpjStatus(@Query('cnpj') cnpj?: string) {
    if (!cnpj?.trim()) {
      throw new BadRequestException('Informe o CNPJ.');
    }
    return this.authService.cnpjStatus(cnpj.trim());
  }

  @Public()
  @Post('google')
  google(@Body() body: unknown) {
    const parsed = googleAuthSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.issues.map((i) => i.message).join(', '),
      );
    }
    return this.authService.googleLogin(parsed.data);
  }

  @Public()
  @Throttle(loginThrottle)
  @Post('login')
  login(@Body() body: unknown) {
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.issues.map((i) => i.message).join(', '),
      );
    }
    return this.authService.login(parsed.data);
  }

  @Public()
  @Post('verify-email')
  verifyEmail(@Body() body: unknown) {
    const parsed = verifyEmailSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException('Token inválido.');
    }
    return this.authService.verifyEmail(parsed.data);
  }

  @Public()
  @Post('forgot-password')
  forgotPassword(@Body() body: unknown) {
    const parsed = forgotPasswordSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException('Informe um email válido.');
    }
    return this.authService.forgotPassword(parsed.data);
  }

  @Post('change-password')
  changePassword(
    @Headers('authorization') authorization: string | undefined,
    @Body() body: unknown,
  ) {
    const token = authorization?.replace(/^Bearer\s+/i, '').trim();
    if (!token) {
      throw new UnauthorizedException('Token ausente.');
    }
    const parsed = changePasswordSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.issues.map((i) => i.message).join(', '),
      );
    }
    return this.authService.changePassword(token, parsed.data);
  }
}
