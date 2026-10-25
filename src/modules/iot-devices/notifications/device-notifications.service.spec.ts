import { BadRequestException, ForbiddenException } from '@nestjs/common';

import { DeviceNotificationsService } from './device-notifications.service';
import { Device } from '../entities/device.iot-entity';
import { DeviceNotificationType } from '../entities/device-notification-type.iot-entity';
import { DeviceNotificationRule } from '../entities/device-notification-rule.iot-entity';
import { loadIotConfig } from '../iot.config';
import { DeviceOutboxService } from '../services/device-outbox.service';
import { DevicePublisher } from '../mqtt/device-publisher';

const TIPOS = [
  { key: 'PANIC', title: 'Alarma de pánico', mandatory: true, urgent: true, priority: 100, deliveryTtlSec: 300 },
  { key: 'PACKAGE', title: 'Paquete en portería', mandatory: false, urgent: false, priority: 50, deliveryTtlSec: 14400 },
  { key: 'VISITOR', title: 'Tienes una visita', mandatory: false, urgent: false, priority: 60, deliveryTtlSec: 600 },
] as DeviceNotificationType[];

const buildHarness = (reglas: Partial<DeviceNotificationRule>[] = []) => {
  const prefs: { userId: string; deviceUuid: string; typeKey: string; enabled: boolean }[] = [];
  const typeRepo = { find: jest.fn(() => Promise.resolve(TIPOS)) };
  const ruleRepo = { find: jest.fn(() => Promise.resolve(reglas)) };
  const prefRepo = {
    find: jest.fn(({ where }: { where: { userId: string; deviceUuid: string } }) =>
      Promise.resolve(prefs.filter((p) => p.userId === where.userId && p.deviceUuid === where.deviceUuid)),
    ),
    upsert: jest.fn((p: (typeof prefs)[number]) => {
      const i = prefs.findIndex((x) => x.userId === p.userId && x.deviceUuid === p.deviceUuid && x.typeKey === p.typeKey);
      if (i >= 0) prefs[i] = p;
      else prefs.push(p);
      return Promise.resolve();
    }),
  };
  const service = new DeviceNotificationsService(
    typeRepo as never,
    ruleRepo as never,
    prefRepo as never,
    {} as never,
    {} as never,
    loadIotConfig({}),
    {} as DeviceOutboxService,
    {} as DevicePublisher,
  );
  return { service, prefs };
};

const device = { id: 'dev-1', complexId: 'complex-1', ownerId: 'ana' } as Device;

describe('DeviceNotificationsService — preferencias', () => {
  it('por defecto todo activado; PANIC obligatorio', async () => {
    const h = buildHarness();
    const prefs = await h.service.getPrefs('ana', device);
    expect(prefs).toEqual(
      expect.arrayContaining([
        { typeKey: 'PANIC', enabled: true, mandatory: true },
        { typeKey: 'PACKAGE', enabled: true, mandatory: false },
      ]),
    );
  });

  it('el residente desactiva un tipo normal', async () => {
    const h = buildHarness();
    const prefs = await h.service.updatePrefs('ana', device, [{ typeKey: 'PACKAGE', enabled: false }]);
    expect(prefs.find((p) => p.typeKey === 'PACKAGE')).toEqual({ typeKey: 'PACKAGE', enabled: false, mandatory: false });
  });

  it('criterio 9: PANIC no se puede desactivar (y no se guarda nada)', async () => {
    const h = buildHarness();
    await expect(
      h.service.updatePrefs('ana', device, [
        { typeKey: 'PACKAGE', enabled: false },
        { typeKey: 'PANIC', enabled: false },
      ]),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(h.prefs).toHaveLength(0);
  });

  it('un tipo que la administración hizo obligatorio tampoco', async () => {
    const h = buildHarness([{ complexId: 'complex-1', typeKey: 'VISITOR', mandatory: true }]);
    await expect(
      h.service.updatePrefs('ana', device, [{ typeKey: 'VISITOR', enabled: false }]),
    ).rejects.toBeInstanceOf(ForbiddenException);
    const tipos = await h.service.listTypes('complex-1');
    expect(tipos.find((t) => t.key === 'VISITOR')?.effectiveMandatory).toBe(true);
  });

  it('tipo desconocido → 400', async () => {
    const h = buildHarness();
    await expect(h.service.updatePrefs('ana', device, [{ typeKey: 'NOPE', enabled: true }])).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
