import {
  ConflictException,
  ForbiddenException,
  GoneException,
  NotFoundException,
} from '@nestjs/common';

import { DevicesService } from './devices.service';
import { DeviceCredentialsService } from './device-credentials.service';
import { DeviceOutboxService } from './device-outbox.service';
import { Device } from '../entities/device.iot-entity';
import { DeviceStatus } from '../enums/device-status.enum';
import { DeviceType } from '../enums/device-type.enum';
import { loadIotConfig } from '../iot.config';
import { PlantProfilesService } from '../plants/plant-profiles.service';
import { IotSocketEmitter, IotSocketEvent } from '../socket/iot-socket.events';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { ValidRoles } from '../../roles/enums/valid-roles';

const userOf = (
  sub: string,
  roles = [ValidRoles.RESIDENT_ROL],
  complexId = 'complex-1',
): JwtAccessPayload => ({
  sub,
  email: `${sub}@test.com`,
  type: 'access',
  entityType: 'user',
  tokenVersion: 1,
  sessionId: 's1',
  roles,
  permissions: [],
  complexId,
});

/**
 * Repositorio de aparatos en memoria. Imita lo que usa el servicio, incluido
 * el UPDATE atómico de la vinculación (con sus condiciones).
 */
const buildHarness = () => {
  const filas = new Map<string, Device>();
  const coincide = (d: Device, where: Partial<Device>) =>
    Object.entries(where).every(
      ([k, v]) => (d as unknown as Record<string, unknown>)[k] === v,
    );
  const buscar = (where: Partial<Device>) =>
    [...filas.values()].find((d) => coincide(d, where)) ?? null;

  const deviceRepo = {
    findOne: jest.fn(({ where }: { where: Partial<Device> }) =>
      Promise.resolve(buscar(where) ? { ...buscar(where) } : null),
    ),
    exists: jest.fn(({ where }: { where: Partial<Device> }) =>
      Promise.resolve(!!buscar(where)),
    ),
    create: jest.fn((d: Partial<Device>) => d as Device),
    save: jest.fn((d: Device) => {
      const fila = {
        ...d,
        id: `00000000-0000-4000-8000-${String(filas.size + 1).padStart(12, '0')}`,
        createdAt: new Date(),
      };
      filas.set(fila.id, fila);
      return Promise.resolve({ ...fila });
    }),
    update: jest.fn((id: string, cambios: Partial<Device>) => {
      Object.assign(filas.get(id), cambios);
      return Promise.resolve({ affected: 1 });
    }),
    createQueryBuilder: jest.fn(() => {
      let set: Partial<Device> = {};
      const params: Record<string, string> = {};
      const qb = {
        update: () => qb,
        set: (v: Partial<Device>) => ((set = v), qb),
        where: (_: string, p: Record<string, string>) => (
          Object.assign(params, p),
          qb
        ),
        andWhere: (_: string, p: Record<string, string>) => (
          Object.assign(params, p),
          qb
        ),
        execute: () => {
          const d = filas.get(params.id);
          const ok =
            !!d &&
            d.pairingCode === params.code &&
            d.pairingCodeExpiresAt > new Date() &&
            (!d.ownerId || d.ownerId === params.u);
          if (ok) Object.assign(d, set);
          return Promise.resolve({ affected: ok ? 1 : 0 });
        },
      };
      return qb;
    }),
  };

  const outbox = {
    sendCommand: jest.fn(() => Promise.resolve(false)),
    discardPending: jest.fn(),
  };
  const sockets = { toUser: jest.fn(), toComplexAdmins: jest.fn() };
  const prefs = { delete: jest.fn() };
  const users = {
    findOne: jest.fn(({ where }: { where: { id: string } }) =>
      Promise.resolve({ name: where.id }),
    ),
  };
  const residents = {
    findOne: jest.fn(() => Promise.resolve({ unitId: 'unit-1' })),
  };
  const complexes = { exists: jest.fn(() => Promise.resolve(true)) };
  const plants = new PlantProfilesService();
  plants.onModuleInit();

  const service = new DevicesService(
    deviceRepo as never,
    {} as never,
    prefs as never,
    users as never,
    residents as never,
    complexes as never,
    loadIotConfig({}),
    new DeviceCredentialsService(deviceRepo as never),
    outbox as unknown as DeviceOutboxService,
    plants,
    sockets as unknown as IotSocketEmitter,
  );
  return { service, filas, outbox, sockets, prefs };
};

const admin = userOf('admin-1', [ValidRoles.COMPLEX_ROL]);
const ana = userOf('ana');
const beto = userOf('beto');

describe('DevicesService — vincular, reset y volver a vincular', () => {
  it('flujo completo: alta → Ana vincula → reset → Beto vincula', async () => {
    const h = buildHarness();

    // Alta de fábrica: deviceKey una sola vez, primer código, sin dueño
    const alta = await h.service.createDevice(
      DeviceType.SMART_PLANTER,
      'complex-1',
      admin,
    );
    expect(alta.device.deviceId).toMatch(/^NEXUS-[0-9A-F]{6}$/);
    expect(alta.deviceKey).toHaveLength(48);
    expect(alta.csvLine).toBe(
      `${alta.device.deviceId},${alta.deviceKey},SMART_PLANTER,complex-1,${alta.pairingCode}`,
    );
    expect(alta.device.deviceKeyHash).toBeUndefined();
    expect(alta.device.status).toBe(DeviceStatus.UNPROVISIONED);

    // La matera pide su código (QR #2) y Ana lo escanea
    const device = h.filas.get(alta.device.id);
    const { code } = await h.service.requestPairingCode(device);
    const deAna = await h.service.linkDeviceByCode(code.toLowerCase(), ana);
    expect(deAna.ownerId).toBe('ana');
    expect(deAna.unitId).toBe('unit-1');
    expect(deAna.pairingCode).toBeNull(); // un solo uso
    expect(h.outbox.sendCommand).toHaveBeenCalledWith(
      expect.anything(),
      'linked',
      { owner: 'ana' },
    );
    expect(h.sockets.toUser).toHaveBeenCalledWith(
      'ana',
      IotSocketEvent.LINKED,
      expect.anything(),
    );

    // El mismo código ya no sirve
    await expect(h.service.linkDeviceByCode(code, beto)).rejects.toBeInstanceOf(
      NotFoundException,
    );

    // Ana la regala: reset de fábrica completo
    const reseteado = await h.service.factoryResetDevice(
      alta.device.deviceId,
      ana,
    );
    expect(reseteado).toMatchObject({
      ownerId: null,
      unitId: null,
      status: DeviceStatus.UNPROVISIONED,
      config: {},
    });
    expect(reseteado.pairingCode).toMatch(/^[0-9A-F]{6}$/);
    expect(reseteado.pairingCode).not.toBe(code);
    expect(h.outbox.discardPending).toHaveBeenCalledWith(alta.device.id);
    expect(h.outbox.sendCommand).toHaveBeenCalledWith(
      expect.anything(),
      'factory_reset',
      {},
    );
    expect(h.prefs.delete).toHaveBeenCalledWith({ deviceUuid: alta.device.id });
    expect(h.sockets.toUser).toHaveBeenCalledWith(
      'ana',
      IotSocketEvent.FACTORY_RESET,
      expect.anything(),
    );

    // Beto la configura desde cero y la vincula
    const nuevo = await h.service.requestPairingCode(
      h.filas.get(alta.device.id),
    );
    const deBeto = await h.service.linkDeviceByCode(nuevo.code, beto);
    expect(deBeto.ownerId).toBe('beto');
  });

  it('código caducado → 410', async () => {
    const h = buildHarness();
    const alta = await h.service.createDevice(
      DeviceType.SMART_PLANTER,
      'complex-1',
      admin,
    );
    h.filas.get(alta.device.id).pairingCodeExpiresAt = new Date(
      Date.now() - 1000,
    );
    await expect(
      h.service.linkDeviceByCode(alta.pairingCode, ana),
    ).rejects.toBeInstanceOf(GoneException);
  });

  it('ya vinculado a otra cuenta → 409; el mismo dueño sí puede volver a vincular', async () => {
    const h = buildHarness();
    const alta = await h.service.createDevice(
      DeviceType.SMART_PLANTER,
      'complex-1',
      admin,
    );
    await h.service.linkDeviceByCode(alta.pairingCode, ana);
    // La matera se reseteó con el botón (sin pasar por el backend) y muestra otro código
    const { code } = await h.service.requestPairingCode(
      h.filas.get(alta.device.id),
    );
    await expect(h.service.linkDeviceByCode(code, beto)).rejects.toBeInstanceOf(
      ConflictException,
    );
    await expect(h.service.linkDeviceByCode(code, ana)).resolves.toMatchObject({
      ownerId: 'ana',
    });
  });

  it('otro conjunto → 403', async () => {
    const h = buildHarness();
    const alta = await h.service.createDevice(
      DeviceType.SMART_PLANTER,
      'complex-1',
      admin,
    );
    await expect(
      h.service.linkDeviceByCode(
        alta.pairingCode,
        userOf('carla', [ValidRoles.RESIDENT_ROL], 'complex-2'),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('nadie más que el dueño o la administración puede resetear', async () => {
    const h = buildHarness();
    const alta = await h.service.createDevice(
      DeviceType.SMART_PLANTER,
      'complex-1',
      admin,
    );
    await h.service.linkDeviceByCode(alta.pairingCode, ana);
    await expect(
      h.service.factoryResetDevice(alta.device.id, beto),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      h.service.factoryResetDevice(alta.device.id, admin),
    ).resolves.toMatchObject({ ownerId: null });
  });

  it('la administración de otro conjunto no da de alta aparatos aquí', async () => {
    const h = buildHarness();
    const otroAdmin = userOf('admin-2', [ValidRoles.COMPLEX_ROL], 'complex-2');
    await expect(
      h.service.createDevice(DeviceType.SMART_PLANTER, 'complex-1', otroAdmin),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('setDevicePlant guarda el perfil (para GET /plant) y manda set_plant', async () => {
    const h = buildHarness();
    const alta = await h.service.createDevice(
      DeviceType.SMART_PLANTER,
      'complex-1',
      admin,
    );
    await h.service.linkDeviceByCode(alta.pairingCode, ana);
    const d = await h.service.setDevicePlant(
      alta.device.id,
      'epipremnum-aureum',
      ana,
    );
    expect(h.service.getPlant(d)).toMatchObject({
      plantId: 'epipremnum-aureum',
      nombre: 'Potus',
    });
    expect(h.outbox.sendCommand).toHaveBeenCalledWith(
      expect.anything(),
      'set_plant',
      expect.objectContaining({ plantId: 'epipremnum-aureum' }),
    );
    const sin = await h.service.clearDevicePlant(alta.device.id, ana);
    expect(h.service.getPlant(sin)).toBeNull(); // → 204
  });
});
