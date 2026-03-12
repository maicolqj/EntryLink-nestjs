import { Resolver, Mutation, Args, Context } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { AuthService } from './services/auth.service';
import { LoginEmailInput } from './dto/inputs/login-email.input';
import { RequestOtpInput } from './dto/inputs/request-otp.input';
import { VerifyOtpInput } from './dto/inputs/verify-otp.input';
import { AuthResponse, OtpRequestResponse } from './dto/responses/auth-response';
import { DeviceInfo } from './interfaces/jwt-payload.interface';
import { JwtAuthGuard } from '../shared/guards/jwt-auth.guard';
import { CurrentUser } from '../shared/decorators/current-user.decorator';
import { JwtAccessPayload } from './interfaces/jwt-payload.interface';
import { Public } from '../shared/decorators/public.decorator';

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
