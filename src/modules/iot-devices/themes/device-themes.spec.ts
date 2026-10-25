import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

import { faceThemeAvailability } from './face-theme.availability';
import { DeviceThemesService } from './device-themes.service';
import { DeviceAckWaiter } from './device-ack-waiter';
import { DeviceIngressService } from '../services/device-ingress.service';
import { Device, DeviceCapabilities } from '../entities/device.iot-entity';
import { DeviceFaceTheme } from '../entities/device-face-theme.iot-entity';
import { DeviceOutboxService } from '../services/device-outbox.service';
import { DevicePublisher } from '../mqtt/device-publisher';
import { IotSocketEmitter, IotSocketEvent } from '../socket/iot-socket.events';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { ValidRoles } from '../../roles/enums/valid-roles';

const SHA = 'f37619f6887df5b271bda111b5bc46afcafe713ab16559e492eebc4b63282fe9';
const CATALOGO: DeviceFaceTheme[] = [
  {
    id: 'classic',
    nombre: 'Clásico',
    kind: 'VECTOR',
    version: 1,
    activo: true,
    sortOrder: 0,
  },
  {
    id: 'minimal',
    nombre: 'Minimalista',
    kind: 'VECTOR',
    version: 1,
    activo: true,
    sortOrder: 1,
  },
  {
    id: 'pastel',
    nombre: 'Pastel',
    kind: 'PACKAGE',
    packageUrl: 'https://files.alternaqj.com/themes/pastel.json',
    sha256: SHA,
    version: 2,
    activo: true,
    sortOrder: 2,
  },
  {
    id: 'futuro',
    nombre: 'Futuro',
    kind: 'VECTOR',
    version: 1,
    activo: true,
    sortOrder: 3,
  },
];

/** Lo que reporta la matera de pruebas: paquetes v1, con pastel v1 instalado. */
const MATERA: DeviceCapabilities = {
  packages: 1,
  storageFree: 120000,
  themes: [
    { id: 'classic', kind: 'vector', available: true },
    { id: 'minimal', kind: 'vector', available: true },
    { id: 'pastel', kind: 'package', version: 1, available: true },
  ],
  reportedAt: '2026-10-24T22:00:00Z',
};

const ana: JwtAccessPayload = {
  sub: 'ana',
  email: 'ana@test.com',
  type: 'access',
  entityType: 'user',
  tokenVersion: 1,
  sessionId: 's1',
  roles: [ValidRoles.RESIDENT_ROL],
  permissions: [],
  complexId: 'complex-1',
};

const tema = (id: string) => CATALOGO.find((t) => t.id === id);

describe('faceThemeAvailability (criterio 4)', () => {
  it('classic siempre; sin informe de la matera, solo classic', () => {
    expect(faceThemeAvailability(tema('classic'), null)).toMatchObject({
      available: true,
      installed: true,
    });
    expect(faceThemeAvailability(tema('pastel'), null)).toMatchObject({
      available: false,
      reason: 'unknown_capabilities',
    });
  });

  it('un VECTOR que su firmware no trae no se ofrece', () => {
    expect(faceThemeAvailability(tema('futuro'), MATERA)).toMatchObject({
      available: false,
      reason: 'not_in_firmware',
    });
    expect(faceThemeAvailability(tema('minimal'), MATERA)).toMatchObject({
      available: true,
      installed: true,
    });
  });

  it('PACKAGE: instalable; instalado solo si tiene esa versión o una más nueva', () => {
    // la matera tiene pastel v1 y el catálogo publica la v2 → hay que reinstalar
    expect(faceThemeAvailability(tema('pastel'), MATERA)).toEqual({
      available: true,
      installed: false,
    });
    expect(
      faceThemeAvailability({ ...tema('pastel'), version: 1 }, MATERA),
    ).toEqual({
      available: true,
      installed: true,
    });
  });

  it('PACKAGE con un firmware que no entiende paquetes → no se ofrece', () => {
    expect(
      faceThemeAvailability(tema('pastel'), { ...MATERA, packages: 0 }),
    ).toMatchObject({
      available: false,
      reason: 'firmware_too_old',
    });
  });
});

const buildHarness = (
  conectada: boolean,
  ackDeLaMatera?: Record<string, unknown>,
) => {
  const waiter = new DeviceAckWaiter();
  const themeRepo = {
    find: jest.fn(() => Promise.resolve(CATALOGO)),
    findOne: jest.fn(({ where }: { where: { id: string } }) =>
      Promise.resolve(CATALOGO.find((t) => t.id === where.id) ?? null),
    ),
  };
  const outbox = {
    sendCommand: jest.fn((d: Device) => {
      // La matera conectada responde al momento por .../ack
      if (conectada && ackDeLaMatera)
        setTimeout(() => waiter.notify(d.deviceId, ackDeLaMatera), 5);
      return Promise.resolve(conectada);
    }),
  };
  const publisher = { isConnected: () => conectada };
  const service = new DeviceThemesService(
    themeRepo as never,
    outbox as unknown as DeviceOutboxService,
    publisher as unknown as DevicePublisher,
    waiter,
  );
  return { service, outbox };
};

const materaDeAna = (partial: Partial<Device> = {}) =>
  ({
    id: 'dev-1',
    deviceId: 'NEXUS-TEST01',
    ownerId: 'ana',
    faceTheme: 'classic',
    capabilities: MATERA,
    ...partial,
  }) as Device;

describe('DeviceThemesService', () => {
  it('lista el catálogo marcando disponible / instalado / activo', async () => {
    const h = buildHarness(true);
    const lista = await h.service.availableThemesForDevice(materaDeAna());
    expect(
      lista.map((t) => [t.id, t.available, t.installed, t.active]),
    ).toEqual([
      ['classic', true, true, true],
      ['minimal', true, true, false],
      ['pastel', true, false, false],
      ['futuro', false, false, false],
    ]);
  });

  it('criterio 2: un vectorial → set_theme y el ack dice aplicado', async () => {
    const h = buildHarness(true, {
      cmd: 'set_theme',
      ok: true,
      themeId: 'minimal',
      theme: 'minimal',
    });
    await expect(
      h.service.setDeviceFaceTheme(materaDeAna(), 'minimal', ana),
    ).resolves.toEqual({
      status: 'applied',
      themeId: 'minimal',
      activeTheme: 'minimal',
      installed: false,
    });
    expect(h.outbox.sendCommand).toHaveBeenCalledWith(
      expect.anything(),
      'set_theme',
      { themeId: 'minimal' },
    );
  });

  it('un paquete que no tiene (o viejo) se instala como una actualización y se activa', async () => {
    const h = buildHarness(true, {
      cmd: 'install_theme',
      ok: true,
      themeId: 'pastel',
      version: 2,
      theme: 'pastel',
    });
    await expect(
      h.service.setDeviceFaceTheme(materaDeAna(), 'pastel', ana),
    ).resolves.toEqual({
      status: 'applied',
      themeId: 'pastel',
      activeTheme: 'pastel',
      installed: true,
    });
    expect(h.outbox.sendCommand).toHaveBeenCalledWith(
      expect.anything(),
      'install_theme',
      {
        themeId: 'pastel',
        url: 'https://files.alternaqj.com/themes/pastel.json',
        sha256: SHA,
        version: 2,
        activate: true,
      },
    );
  });

  it('la matera rechaza el paquete (SHA-256 no coincide) → sigue en classic con el motivo', async () => {
    const h = buildHarness(true, {
      cmd: 'install_theme',
      ok: false,
      themeId: 'pastel',
      error: 'sha256_mismatch',
      theme: 'classic',
    });
    await expect(
      h.service.setDeviceFaceTheme(materaDeAna(), 'pastel', ana),
    ).resolves.toMatchObject({
      status: 'rejected',
      activeTheme: 'classic',
      reason: 'sha256_mismatch',
    });
  });

  it('dormida (batería) → pending: llega al despertar y el resultado sale por device:theme', async () => {
    const h = buildHarness(false);
    await expect(
      h.service.setDeviceFaceTheme(materaDeAna(), 'minimal', ana),
    ).resolves.toMatchObject({
      status: 'pending',
      activeTheme: 'classic',
    });
  });

  it('un tema que esta matera no puede mostrar ni se envía (400)', async () => {
    const h = buildHarness(true);
    await expect(
      h.service.setDeviceFaceTheme(materaDeAna(), 'futuro', ana),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(h.outbox.sendCommand).not.toHaveBeenCalled();
  });

  it('tema desconocido 404 · otro dueño 403 · classic no se borra', async () => {
    const h = buildHarness(true);
    await expect(
      h.service.setDeviceFaceTheme(materaDeAna(), 'nope', ana),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      h.service.setDeviceFaceTheme(
        materaDeAna({ ownerId: 'beto' }),
        'minimal',
        ana,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      h.service.removeDeviceFaceTheme(materaDeAna(), 'classic', ana),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('DeviceIngressService.recordAck (temas)', () => {
  const build = () => {
    const deviceRepo = { update: jest.fn(() => Promise.resolve()) };
    const sockets = { toUser: jest.fn() };
    const waiter = new DeviceAckWaiter();
    const service = new DeviceIngressService(
      deviceRepo as never,
      {} as never,
      {} as never,
      sockets as unknown as IotSocketEmitter,
      waiter,
    );
    return { service, deviceRepo, sockets, waiter };
  };

  it('guarda las capacidades y el tema del informe "themes"', async () => {
    const h = build();
    await h.service.recordAck(materaDeAna(), {
      cmd: 'themes',
      ok: true,
      theme: 'pastel',
      packages: 1,
      storageFree: 118000,
      themes: [{ id: 'pastel', kind: 'package', version: 2, available: true }],
    });
    const cambios = (
      h.deviceRepo.update.mock.calls[0] as unknown[]
    )[1] as Partial<Device>;
    expect(cambios.faceTheme).toBe('pastel');
    expect(cambios.capabilities).toMatchObject({
      packages: 1,
      storageFree: 118000,
      themes: [{ id: 'pastel', kind: 'package', version: 2, available: true }],
    });
  });

  it('install_theme: guarda el activo, emite device:theme y despierta a la mutation', async () => {
    const h = build();
    const espera = h.waiter.wait('NEXUS-TEST01', 'install_theme', 1000);
    await h.service.recordAck(materaDeAna(), {
      cmd: 'install_theme',
      ok: true,
      themeId: 'pastel',
      version: 2,
      theme: 'pastel',
    });
    await expect(espera).resolves.toMatchObject({ ok: true, theme: 'pastel' });
    expect(h.deviceRepo.update).toHaveBeenCalledWith(
      'dev-1',
      expect.objectContaining({ faceTheme: 'pastel' }),
    );
    expect(h.sockets.toUser).toHaveBeenCalledWith(
      'ana',
      IotSocketEvent.THEME,
      expect.objectContaining({
        cmd: 'install_theme',
        ok: true,
        themeId: 'pastel',
        theme: 'pastel',
      }),
    );
  });
});
