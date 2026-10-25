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

const CATALOGO: DeviceFaceTheme[] = [
  {
    id: 'classic',
    nombre: 'Clásico',
    kind: 'VECTOR',
    requires: 'none',
    activo: true,
    sortOrder: 0,
  },
  {
    id: 'minimal',
    nombre: 'Minimalista',
    kind: 'VECTOR',
    requires: 'none',
    activo: true,
    sortOrder: 1,
  },
  {
    id: 'greeny',
    nombre: 'Greeny',
    kind: 'BITMAP',
    requires: 'sd',
    activo: true,
    sortOrder: 2,
  },
  {
    id: 'deluxe',
    nombre: 'Deluxe',
    kind: 'BITMAP',
    requires: 'psram',
    activo: true,
    sortOrder: 3,
  },
];

/** Lo que reporta la FireBeetle de pruebas: sin SD ni PSRAM, dos vectoriales. */
const FIREBEETLE: DeviceCapabilities = {
  hasSD: false,
  hasPSRAM: false,
  themes: [
    { id: 'classic', kind: 'vector', available: true },
    { id: 'minimal', kind: 'vector', available: true },
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

describe('faceThemeAvailability (criterio 4)', () => {
  const tema = (id: string) => CATALOGO.find((t) => t.id === id);

  it('classic siempre; sin informe de la matera, solo classic', () => {
    expect(faceThemeAvailability(tema('classic'), null)).toEqual({
      available: true,
    });
    expect(faceThemeAvailability(tema('minimal'), null)).toEqual({
      available: false,
      reason: 'unknown_capabilities',
    });
  });

  it('BITMAP sin SD / sin PSRAM no se ofrece', () => {
    expect(faceThemeAvailability(tema('greeny'), FIREBEETLE)).toEqual({
      available: false,
      reason: 'needs_sd',
    });
    expect(faceThemeAvailability(tema('deluxe'), FIREBEETLE)).toEqual({
      available: false,
      reason: 'needs_psram',
    });
  });

  it('con SD manda lo que dice la matera (faltan imágenes, no instalado)', () => {
    const conSd = {
      ...FIREBEETLE,
      hasSD: true,
      themes: [
        ...FIREBEETLE.themes,
        { id: 'greeny', available: false, reason: 'missing_assets' },
      ],
    };
    expect(faceThemeAvailability(tema('greeny'), conSd)).toEqual({
      available: false,
      reason: 'missing_assets',
    });
    const sinListar = { ...FIREBEETLE, hasSD: true };
    expect(faceThemeAvailability(tema('greeny'), sinListar)).toEqual({
      available: false,
      reason: 'not_installed',
    });
  });

  it('un vectorial que esta matera reporta → disponible', () => {
    expect(faceThemeAvailability(tema('minimal'), FIREBEETLE)).toEqual({
      available: true,
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
    capabilities: FIREBEETLE,
    ...partial,
  }) as Device;

describe('DeviceThemesService', () => {
  it('lista el catálogo marcando lo que esta matera puede mostrar y el activo', async () => {
    const h = buildHarness(true);
    const lista = await h.service.availableThemesForDevice(materaDeAna());
    expect(lista.map((t) => [t.id, t.available, t.active])).toEqual([
      ['classic', true, true],
      ['minimal', true, false],
      ['greeny', false, false],
      ['deluxe', false, false],
    ]);
  });

  it('criterio 2: conectada → set_theme y el ack dice aplicado', async () => {
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
    });
    expect(h.outbox.sendCommand).toHaveBeenCalledWith(
      expect.anything(),
      'set_theme',
      { themeId: 'minimal' },
    );
  });

  it('criterio 3: la matera lo rechaza → sigue en classic y vuelve el motivo', async () => {
    const h = buildHarness(true, {
      cmd: 'set_theme',
      ok: false,
      themeId: 'minimal',
      reason: 'needs_sd',
      theme: 'classic',
    });
    await expect(
      h.service.setDeviceFaceTheme(materaDeAna(), 'minimal', ana),
    ).resolves.toEqual({
      status: 'rejected',
      themeId: 'minimal',
      activeTheme: 'classic',
      reason: 'needs_sd',
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
      h.service.setDeviceFaceTheme(materaDeAna(), 'greeny', ana),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(h.outbox.sendCommand).not.toHaveBeenCalled();
  });

  it('tema desconocido 404 · otro dueño 403', async () => {
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
      theme: 'minimal',
      hasSD: false,
      hasPSRAM: false,
      themes: [{ id: 'classic', kind: 'vector', available: true }],
    });
    const cambios = (
      h.deviceRepo.update.mock.calls[0] as unknown[]
    )[1] as Partial<Device>;
    expect(cambios.faceTheme).toBe('minimal');
    expect(cambios.capabilities).toMatchObject({
      hasSD: false,
      hasPSRAM: false,
      themes: [{ id: 'classic', kind: 'vector', available: true }],
    });
  });

  it('set_theme: guarda el activo, emite device:theme y despierta a la mutation', async () => {
    const h = build();
    const espera = h.waiter.wait('NEXUS-TEST01', 'set_theme', 1000);
    await h.service.recordAck(materaDeAna(), {
      cmd: 'set_theme',
      ok: false,
      themeId: 'greeny',
      reason: 'needs_sd',
      theme: 'classic',
    });
    await expect(espera).resolves.toMatchObject({
      ok: false,
      reason: 'needs_sd',
    });
    expect(h.deviceRepo.update).toHaveBeenCalledWith(
      'dev-1',
      expect.objectContaining({ faceTheme: 'classic' }),
    );
    expect(h.sockets.toUser).toHaveBeenCalledWith(
      'ana',
      IotSocketEvent.THEME,
      expect.objectContaining({
        ok: false,
        themeId: 'greeny',
        theme: 'classic',
        reason: 'needs_sd',
      }),
    );
  });
});
