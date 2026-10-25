import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import * as bcryptModule from 'bcrypt';

import { DeviceKeyGuard } from './device-key.guard';
import { DeviceCredentialsService } from '../services/device-credentials.service';
import { Device } from '../entities/device.iot-entity';

interface Bcrypt {
  hash(data: string, rounds: number): Promise<string>;
}
const bcrypt = bcryptModule as unknown as Bcrypt;

const CLAVE = 'afa2c0ffee0123456789abcdef0123456789abcdef012345';

/** Credenciales reales (bcrypt) contra un repositorio en memoria. */
const buildCredentials = async () => {
  const device = {
    id: 'dev-1',
    deviceId: 'NEXUS-TEST01',
    deviceKeyHash: await bcrypt.hash(CLAVE, 4),
  } as Device;
  const qb = {
    addSelect: () => qb,
    where: (_: string, p: { deviceId: string }) => {
      qb.buscado = p.deviceId;
      return qb;
    },
    buscado: '',
    getOne: () => Promise.resolve(qb.buscado === device.deviceId ? { ...device } : null),
  };
  const repo = { createQueryBuilder: () => qb };
  return new DeviceCredentialsService(repo as never);
};

const ctxDe = (headers: Record<string, string>, params: Record<string, string> = {}) => {
  const req = {
    header: (n: string) => headers[n.toLowerCase()],
    params,
    iotDevice: undefined as Device | undefined,
  };
  const ctx = { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
  return { ctx, req };
};

describe('DeviceKeyGuard', () => {
  it('acepta X-Device-Id + X-Device-Key correctos y deja el aparato en la petición (sin hash)', async () => {
    const guard = new DeviceKeyGuard(await buildCredentials());
    const { ctx, req } = ctxDe({ 'x-device-id': 'NEXUS-TEST01', 'x-device-key': CLAVE });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(req.iotDevice?.deviceId).toBe('NEXUS-TEST01');
    expect(req.iotDevice?.deviceKeyHash).toBeUndefined();
  });

  it.each([
    ['clave mala', { 'x-device-id': 'NEXUS-TEST01', 'x-device-key': 'mala' }],
    ['aparato desconocido', { 'x-device-id': 'NEXUS-OTRO', 'x-device-key': CLAVE }],
    ['sin cabeceras', {}],
  ])('401 con %s', async (_, headers) => {
    const guard = new DeviceKeyGuard(await buildCredentials());
    await expect(guard.canActivate(ctxDe(headers).ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('401 si el :deviceId de la ruta es de otro aparato', async () => {
    const guard = new DeviceKeyGuard(await buildCredentials());
    const { ctx } = ctxDe({ 'x-device-id': 'NEXUS-TEST01', 'x-device-key': CLAVE }, { deviceId: 'NEXUS-B' });
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('la caché solo vale para la misma clave', async () => {
    const credentials = await buildCredentials();
    await expect(credentials.verify('NEXUS-TEST01', CLAVE)).resolves.toBeTruthy();
    await expect(credentials.verify('NEXUS-TEST01', CLAVE)).resolves.toBeTruthy();
    await expect(credentials.verify('NEXUS-TEST01', `${CLAVE}x`)).resolves.toBeNull();
  });
});
