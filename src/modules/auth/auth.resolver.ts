import { Resolver, Mutation, Args, Context } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { AuthService } from './services/auth.service';
import { LoginEmailInput } from './dto/inputs/login-email.input';
import { RequestOtpInput } from './dto/inputs/request-otp.input';
import { VerifyOtpInput } from './dto/inputs/verify-otp.input';
import { AuthResponse, OtpRequestResponse } from './dto/responses/auth-response';
import { QrLoginTokenResponse } from './dto/responses/qr-login-token.response';
import { SetPasswordResponse } from './dto/responses/set-password.response';
import { RequestPasswordResetResponse } from './dto/responses/request-password-reset.response';
import { ResetPasswordInput } from './dto/inputs/reset-password.input';
import { DeviceInfo } from './interfaces/jwt-payload.interface';
import { JwtAuthGuard } from '../shared/guards/jwt-auth.guard';
import { CurrentUser } from '../shared/decorators/current-user.decorator';
import { JwtAccessPayload } from './interfaces/jwt-payload.interface';
import { Public } from '../shared/decorators/public.decorator';
import { Auth } from '../shared/decorators/auth.decorator';
import { ValidRoles } from '../roles/enums/valid-roles';

@Resolver()
export class AuthResolver {
  constructor(private readonly authService: AuthService) {}

  // ── Login por email (SUPER_ADMIN, COMPLIANCE_OFFICER, COMPLEX_ROL) ──────

  @Public()
  @Mutation(() => AuthResponse, {
    name: 'loginWithEmail',
    description:
      'Inicia sesión con email y contraseña. ' +
      'Disponible para: SUPER_ADMIN_ROL, COMPILANCE_OFFICER_ROL, COMPLEX_ROL',
  })
  async loginWithEmail(
    @Args('input') input: LoginEmailInput,
    @Context() context: any,
  ): Promise<AuthResponse> {
    const deviceInfo = this.extractDeviceInfo(context);
    return this.authService.loginWithEmail(input, deviceInfo);
  }

  // ── OTP: Solicitar código (RESIDENT_ROL) ─────────────────────────────────

  @Public()
  @Mutation(() => OtpRequestResponse, {
    name: 'requestOtp',
    description:
      'Solicita un código OTP al número de celular. ' +
      'Exclusivo para residentes (RESIDENT_ROL). ' +
      'El código se envía por SMS y tiene validez de 5 minutos.',
  })
  async requestOtp(
    @Args('input') input: RequestOtpInput,
    @Context() context: any,
  ): Promise<OtpRequestResponse> {
    const ip = this.extractIp(context);
    return this.authService.requestOtp(input, ip);
  }

  // ── OTP: Verificar código y obtener tokens ────────────────────────────────

  @Public()
  @Mutation(() => AuthResponse, {
    name: 'verifyOtp',
    description:
      'Verifica el código OTP del residente y devuelve los tokens JWT de acceso.',
  })
  async verifyOtp(
    @Args('input') input: VerifyOtpInput,
    @Context() context: any,
  ): Promise<AuthResponse> {
    const deviceInfo = this.extractDeviceInfo(context);
    return this.authService.verifyOtp(input, deviceInfo);
  }

  // ── QR Login: Generar token ───────────────────────────────────────────────

  @Auth({ roles: [ValidRoles.SUPER_ADMIN_ROL] })
  @Mutation(() => QrLoginTokenResponse, {
    name: 'generateQrLoginToken',
    description:
      'Genera un token QR de un solo uso (72 h de vigencia) para que un usuario inicie sesión sin contraseña. ' +
      'Solo accesible por SUPER_ADMIN.',
  })
  async generateQrLoginToken(
    @Args('userId', { type: () => String }) userId: string,
  ): Promise<QrLoginTokenResponse> {
    return this.authService.generateQrLoginToken(userId);
  }

  // ── QR Login: Canjear token ───────────────────────────────────────────────

  @Public()
  @Mutation(() => AuthResponse, {
    name: 'redeemQrToken',
    description:
      'Canjea el token QR de un solo uso validando el PIN (últimos 4 dígitos del documento). ' +
      'No requiere autenticación previa.',
  })
  async redeemQrToken(
    @Args('token', { type: () => String }) token: string,
    @Args('pin', { type: () => String }) pin: string,
    @Context() context: any,
  ): Promise<AuthResponse> {
    const deviceInfo = this.extractDeviceInfo(context);
    return this.authService.redeemQrToken(token, pin, deviceInfo);
  }

  // ── Establecer contraseña inicial ────────────────────────────────────────

  @UseGuards(JwtAuthGuard)
  @Mutation(() => SetPasswordResponse, {
    name: 'setInitialPassword',
    description:
      'Establece la contraseña inicial del usuario autenticado. ' +
      'Diseñado para el flujo post-login por QR donde el usuario aún no tiene contraseña propia.',
  })
  async setInitialPassword(
    @Args('newPassword', { type: () => String }) newPassword: string,
    @CurrentUser() payload: JwtAccessPayload,
  ): Promise<SetPasswordResponse> {
    return this.authService.setInitialPassword(payload.sub, newPassword);
  }

  // ── Refresh Token ────────────────────────────────────────────────────────

  @Public()
  @Mutation(() => AuthResponse, {
    name: 'refreshToken',
    description: 'Renueva el access token usando el refresh token. Implementa rotación de tokens.',
  })
  async refreshToken(
    @Args('refreshToken', { type: () => String }) refreshToken: string,
    @Context() context: any,
  ): Promise<AuthResponse> {
    const deviceInfo = this.extractDeviceInfo(context);
    return this.authService.refreshToken(refreshToken, deviceInfo);
  }

  // ── Logout ───────────────────────────────────────────────────────────────

  @UseGuards(JwtAuthGuard)
  @Mutation(() => Boolean, {
    name: 'logout',
    description: 'Cierra la sesión actual e invalida los tokens.',
  })
  async logout(
    @CurrentUser() payload: JwtAccessPayload,
    @Context() context: any,
  ): Promise<boolean> {
    const accessToken = context.req?.headers?.authorization?.replace('Bearer ', '') ?? '';
    return this.authService.logout(payload.sub, payload.sessionId, accessToken);
  }

  // ── Reset de contraseña por email ────────────────────────────────────────

  @Public()
  @Mutation(() => RequestPasswordResetResponse, {
    name: 'requestPasswordReset',
    description:
      'Solicita un enlace de restablecimiento de contraseña por email. ' +
      'Siempre devuelve respuesta genérica para no revelar si el email existe.',
  })
  async requestPasswordReset(
    @Args('email', { type: () => String }) email: string,
  ): Promise<RequestPasswordResetResponse> {
    return this.authService.requestPasswordReset(email);
  }

  @Public()
  @Mutation(() => SetPasswordResponse, {
    name: 'resetPassword',
    description:
      'Restablece la contraseña usando el token recibido por email. ' +
      'El token es de un solo uso y tiene una validez de 30 minutos.',
  })
  async resetPassword(
    @Args('input') input: ResetPasswordInput,
  ): Promise<SetPasswordResponse> {
    return this.authService.resetPassword(input.token, input.newPassword);
  }

  // ── Helpers privados ─────────────────────────────────────────────────────

  private extractDeviceInfo(context: any): DeviceInfo {
    const req = context?.req ?? {};
    const ua = req.headers?.['user-agent'] ?? 'unknown';
    const ip = this.extractIp(context);
    const platform = this.detectPlatform(ua);
    const deviceId = req.headers?.['x-device-id'] as string | undefined;
    const appVersion = req.headers?.['x-app-version'] as string | undefined;

    // Fingerprint simple: hash de ua + ip + deviceId
    const fingerprint = Buffer.from(`${ua}|${ip}|${deviceId ?? 'web'}`).toString('base64');

    return { fingerprint, userAgent: ua, ip, platform, deviceId, appVersion };
  }

  private extractIp(context: any): string {
    const req = context?.req ?? {};
    return (
      (req.headers?.['x-forwarded-for'] as string)?.split(',')[0]?.trim() ??
      req.socket?.remoteAddress ??
      '0.0.0.0'
    );
  }

  private detectPlatform(userAgent: string): 'ios' | 'android' | 'web' {
    const ua = userAgent.toLowerCase();
    if (ua.includes('iphone') || ua.includes('ipad')) return 'ios';
    if (ua.includes('android')) return 'android';
    return 'web';
  }
}
