import { Resolver, Mutation, Query, Args, Context, ID } from '@nestjs/graphql';
import { ConfigService } from '@nestjs/config';

import { ResidentDeviceService } from './services/resident-device.service';
import { ResidentDevice } from './entities/resident-device.entity';
import { SetAccessCodeInput } from './dto/inputs/set-access-code.input';
import { LoginAccessCodeInput } from './dto/inputs/login-access-code.input';
import { AuthResponse } from './dto/responses/auth-response';
import { JwtAccessPayload } from './interfaces/jwt-payload.interface';
import { buildDeviceInfo } from './utils/device-info.util';
import { Public } from '../shared/decorators/public.decorator';
import { Auth } from '../shared/decorators/auth.decorator';
import { CurrentUser } from '../shared/decorators/current-user.decorator';
import { ValidRoles } from '../roles/enums/valid-roles';

/**
 * Clave de acceso del residente y gestión de sus dispositivos.
 *
 * La clave es una por cuenta: se crea en el primer ingreso —llegado por
 * WhatsApp entrante o por aprobación desde otro equipo— y sirve en todos los
 * dispositivos vinculados, sin consumir mensajes.
 *
 * Todas las operaciones exigen el header `x-device-id`.
 */
@Resolver()
export class ResidentDeviceResolver {
  constructor(
    private readonly residentDeviceService: ResidentDeviceService,
    private readonly configService: ConfigService,
  ) {}

  // ── Clave de acceso (requiere sesión activa) ─────────────────────────────

  @Auth({ roles: [ValidRoles.RESIDENT_ROL] })
  @Mutation(() => ResidentDevice, {
    name: 'setResidentAccessCode',
    description:
      'Fija o cambia la clave de acceso del residente autenticado y vincula el dispositivo actual ' +
      '(header x-device-id). La clave es una sola por cuenta y sirve en todos sus equipos vinculados. ' +
      'Cambiarla exige enviar `currentCode`, salvo que el ingreso reciente haya sido por WhatsApp ' +
      'entrante o por aprobación desde otro equipo, que es el camino del olvido.',
  })
  async setResidentAccessCode(
    @Args('input') input: SetAccessCodeInput,
    @CurrentUser() payload: JwtAccessPayload,
    @Context() context: any,
  ): Promise<ResidentDevice> {
    const deviceInfo = this.deviceInfo(context);
    return this.residentDeviceService.setAccessCode(
      payload.sub,
      input.code,
      deviceInfo,
      input.label,
      input.currentCode,
    );
  }

  @Auth({ roles: [ValidRoles.RESIDENT_ROL] })
  @Query(() => Boolean, {
    name: 'residentHasAccessCode',
    description:
      'Indica si la cuenta ya tiene clave de acceso. El cliente la consulta tras iniciar sesión ' +
      'para exigir su creación cuando falta.',
  })
  async residentHasAccessCode(@CurrentUser() payload: JwtAccessPayload): Promise<boolean> {
    return this.residentDeviceService.hasAccessCode(payload.sub);
  }

  // ── Login ─────────────────────────────────────────────────────────────────

  @Public()
  @Mutation(() => AuthResponse, {
    name: 'loginWithAccessCode',
    description:
      'Inicia sesión con la clave de acceso (header x-device-id). Desde un equipo ya vinculado basta ' +
      'la clave; desde uno nuevo hay que enviar además `identity`, y el ingreso vincula el equipo y ' +
      'avisa por push a los demás. Exclusivo para RESIDENT_ROL. No envía ningún mensaje de WhatsApp.',
  })
  async loginWithAccessCode(
    @Args('input') input: LoginAccessCodeInput,
    @Context() context: any,
  ): Promise<AuthResponse> {
    const deviceInfo = this.deviceInfo(context);
    return this.residentDeviceService.loginWithAccessCode(
      input.code,
      deviceInfo,
      input.identity,
      input.label,
    );
  }

  // ── Gestión de dispositivos ───────────────────────────────────────────────

  @Auth({ roles: [ValidRoles.RESIDENT_ROL] })
  @Query(() => [ResidentDevice], {
    name: 'myResidentDevices',
    description: 'Lista los dispositivos vinculados del residente autenticado.',
  })
  async myResidentDevices(
    @CurrentUser() payload: JwtAccessPayload,
  ): Promise<ResidentDevice[]> {
    return this.residentDeviceService.listDevices(payload.sub);
  }

  @Auth({ roles: [ValidRoles.RESIDENT_ROL] })
  @Mutation(() => Boolean, {
    name: 'revokeResidentDevice',
    description:
      'Desvincula un dispositivo (ej. celular perdido) y cierra su sesión. ' +
      'Las sesiones de los demás dispositivos del residente no se ven afectadas.',
  })
  async revokeResidentDevice(
    @Args('deviceId', { type: () => ID }) deviceId: string,
    @CurrentUser() payload: JwtAccessPayload,
  ): Promise<boolean> {
    return this.residentDeviceService.revokeDevice(payload.sub, deviceId);
  }

  @Auth({ roles: [ValidRoles.RESIDENT_ROL] })
  @Mutation(() => Number, {
    name: 'revokeMyOtherDevices',
    description:
      'Desvincula todos los equipos del residente salvo el actual y cierra sus sesiones. ' +
      'Pensado para el celular perdido: se entra desde el equipo nuevo y se corta el acceso del anterior. ' +
      'Devuelve cuántos se revocaron.',
  })
  async revokeMyOtherDevices(
    @CurrentUser() payload: JwtAccessPayload,
    @Context() context: any,
  ): Promise<number> {
    return this.residentDeviceService.revokeOtherDevices(payload.sub, this.deviceInfo(context));
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private deviceInfo(context: any) {
    return buildDeviceInfo(context, this.configService.getOrThrow<string>('FINGERPRINT_SECRET'));
  }
}
