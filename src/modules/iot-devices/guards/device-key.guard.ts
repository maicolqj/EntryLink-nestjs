import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';

import { DeviceCredentialsService } from '../services/device-credentials.service';
import type { Device } from '../entities/device.iot-entity';

type RequestConAparato = Request & { iotDevice?: Device };

/**
 * Autenticación de los APARATOS en REST: cabeceras X-Device-Id + X-Device-Key
 * contra el hash bcrypt. No usa el JWT de usuarios. Si la ruta lleva
 * `:deviceId`, debe ser el mismo aparato que se autentica.
 * Fallo → 401 (el firmware reintenta más tarde y lo muestra como error).
 */
@Injectable()
export class DeviceKeyGuard implements CanActivate {
  constructor(private readonly credentials: DeviceCredentialsService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<RequestConAparato>();
    const id = req.header('x-device-id');
    const key = req.header('x-device-key');
    const device = await this.credentials.verify(id, key);
    if (!device)
      throw new UnauthorizedException('Credenciales de dispositivo inválidas');
    const enRuta = req.params?.deviceId;
    if (enRuta && enRuta !== device.deviceId)
      throw new UnauthorizedException('El dispositivo no coincide');
    req.iotDevice = device;
    return true;
  }
}

/** El aparato que autenticó DeviceKeyGuard. */
export const CurrentDevice = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): Device => {
    const device = ctx.switchToHttp().getRequest<RequestConAparato>().iotDevice;
    if (!device) throw new UnauthorizedException('Dispositivo no autenticado');
    return device;
  },
);
