import { DeviceIngressService } from './device-ingress.service';
import { Device } from '../entities/device.iot-entity';
import { DeviceType } from '../enums/device-type.enum';
import { DeviceStatus } from '../enums/device-status.enum';
import { IotSocketEmitter } from '../socket/iot-socket.events';

const LECTURA = {
  type: 'SMART_PLANTER',
  fw: '0.4.0',
  ts: 1792892603,
  soil: 22,
  tank: 'ok',
  battery: 4.1,
  power: 'usb',
};

const buildHarness = (insertado = true) => {
  const insertados: unknown[] = [];
  const readingRepo = {
    createQueryBuilder: () => {
      const qb = {
        insert: () => qb,
        into: () => qb,
        values: (v: unknown) => (insertados.push(v), qb),
        orIgnore: () => qb,
        returning: () => qb,
        execute: () =>
          Promise.resolve({
            identifiers: insertado ? [{ id: 'r-1' }] : [],
            raw: [],
          }),
      };
      return qb;
    },
  };
  const deviceRepo = { update: jest.fn(() => Promise.resolve()) };
  const queue = { add: jest.fn(() => Promise.resolve()) };
  const sockets = { toUser: jest.fn() };
  const service = new DeviceIngressService(
    deviceRepo as never,
    readingRepo as never,
    queue as never,
    sockets as unknown as IotSocketEmitter,
    { notify: jest.fn() } as never,
  );
  return { service, deviceRepo, queue, sockets, insertados };
};

const deviceOf = (partial: Partial<Device> = {}): Device =>
  ({
    id: 'dev-1',
    deviceId: 'NEXUS-7F3A9C',
    type: DeviceType.SMART_PLANTER,
    ownerId: 'ana',
    ...partial,
  }) as Device;

describe('DeviceIngressService.ingestTelemetry', () => {
  it('criterio 2: sin dueño guarda la telemetría pero no avisa a nadie', async () => {
    const h = buildHarness();
    await expect(
      h.service.ingestTelemetry(deviceOf({ ownerId: null }), LECTURA, 'mqtt'),
    ).resolves.toEqual({ ok: true });
    expect(h.insertados).toHaveLength(1);
    expect(h.queue.add).not.toHaveBeenCalled();
    expect(h.sockets.toUser).not.toHaveBeenCalled();
    expect(h.deviceRepo.update).toHaveBeenCalledWith(
      'dev-1',
      expect.objectContaining({
        status: DeviceStatus.ONLINE,
        firmwareVersion: '0.4.0',
        power: 'usb',
      }),
    );
  });

  it('con dueño: socket device:telemetry y alertas en cola (la respuesta no las espera)', async () => {
    const h = buildHarness();
    await h.service.ingestTelemetry(deviceOf(), LECTURA, 'rest');
    expect(h.sockets.toUser).toHaveBeenCalledWith(
      'ana',
      'device:telemetry',
      expect.anything(),
    );
    expect(h.queue.add).toHaveBeenCalledWith(
      'evaluate-reading',
      { deviceUuid: 'dev-1', readingId: 'r-1' },
      expect.anything(),
    );
  });

  it('una lectura de la cola no genera alertas ni pisa el estado actual', async () => {
    const h = buildHarness();
    await h.service.ingestTelemetry(
      deviceOf(),
      { ...LECTURA, queued: true },
      'rest',
    );
    expect(h.queue.add).not.toHaveBeenCalled();
    const cambios = (
      h.deviceRepo.update.mock.calls[0] as unknown[]
    )[1] as Partial<Device>;
    expect(cambios.lastTelemetry).toBeUndefined();
    expect(cambios.power).toBeUndefined();
  });

  it('la misma lectura dos veces (MQTT + REST) se ignora', async () => {
    const h = buildHarness(false);
    await expect(
      h.service.ingestTelemetry(deviceOf(), LECTURA, 'rest'),
    ).resolves.toEqual({ ok: true, duplicate: true });
    expect(h.queue.add).not.toHaveBeenCalled();
    expect(h.deviceRepo.update).not.toHaveBeenCalled();
  });

  it('JSON inválido → error sin guardar nada', async () => {
    const h = buildHarness();
    await expect(
      h.service.ingestTelemetry(deviceOf(), { soil: 'mucho' }, 'mqtt'),
    ).resolves.toEqual({
      ok: false,
      error: 'bad_soil',
    });
    expect(h.insertados).toHaveLength(0);
  });
});
