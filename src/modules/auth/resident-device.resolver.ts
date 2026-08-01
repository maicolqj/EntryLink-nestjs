import { Resolver, Mutation, Query, Args, Context, ID } from '@nestjs/graphql';
import { ConfigService } from '@nestjs/config';

import { ResidentDeviceService } from './services/resident-device.service';
import { ResidentDevice } from './entities/resident-device.entity';
import { SetDevicePinInput } from './dto/inputs/set-device-pin.input';
import { LoginDevicePinInput } from './dto/inputs/login-device-pin.input';
import { AuthResponse } from './dto/responses/auth-response';
import { JwtAccessPayload } from './interfaces/jwt-payload.interface';
import { buildDeviceInfo } from './utils/device-info.util';
import { Public } from '../shared/decorators/public.decorator';
import { Auth } from '../shared/decorators/auth.decorator';
import { CurrentUser } from '../shared/decorators/current-user.decorator';
import { ValidRoles } from '../roles/enums/valid-roles';

/**
 * Login de residentes sin costo por mensaje: se vincula el dispositivo una vez
 * (con la sesión ya abierta por documento + systemCode) y después se entra con
 * un PIN de 6 dígitos.
 *
 * Todas las operaciones exigen el header `x-device-id`.
 */
@Resolver()
export class ResidentDeviceResolver {
  constructor(
    private readonly residentDeviceService: ResidentDeviceService,
    private readonly configService: ConfigService,
  ) {}

  // ── Vinculación (requiere sesión activa) ─────────────────────────────────

  @Auth({ roles: [ValidRoles.RESIDENT_ROL] })
  @Mutation(() => ResidentDevice, {
    name: 'setResidentDevicePin',
    description:
      'Vincula el dispositivo actual (header x-device-id) al residente autenticado y fija su PIN de 6 dígitos. ' +
      'A partir de aquí el residente inicia sesión con loginWithDevicePin, sin consumir mensajes de WhatsApp.',
  })
  async setResidentDevicePin(
    @Args('input') input: SetDevicePinInput,
    @CurrentUser() payload: JwtAccessPayload,
    @Context() context: any,
  ): Promise<ResidentDevice> {
    const deviceInfo = this.deviceInfo(context);
    return this.residentDeviceService.setDevicePin(payload.sub, input.pin, deviceInfo, input.label);
  }

  // ── Login por PIN ─────────────────────────────────────────────────────────

  @Public()
  @Mutation(() => AuthResponse, {
    name: 'loginWithDevicePin',
    description:
      'Inicia sesión con el PIN del dispositivo vinculado (header x-device-id). ' +
      'Exclusivo para RESIDENT_ROL. No envía ningún mensaje.',
  })
  async loginWithDevicePin(
    @Args('input') input: LoginDevicePinInput,
    @Context() context: any,
  ): Promise<AuthResponse> {
    const deviceInfo = this.deviceInfo(context);
    return this.residentDeviceService.loginWithDevicePin(input.pin, deviceInfo);
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

  // ── Helpers ───────────────────────────────────────────────────────────────

  private deviceInfo(context: any) {
    return buildDeviceInfo(context, this.configService.getOrThrow<string>('FINGERPRINT_SECRET'));
  }
}
