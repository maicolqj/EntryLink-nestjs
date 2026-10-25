import { DeviceAlertDispatcher } from './device-alert.dispatcher';
import { Device } from '../entities/device.iot-entity';
import { DeviceAlert } from '../entities/device-alert.iot-entity';
import { loadIotConfig } from '../iot.config';
import { NotificationsService } from '../../notifications/services/notifications.service';
import { IotSocketEmitter } from '../socket/iot-socket.events';

const deviceOf = (partial: Partial<Device> = {}): Device =>
  ({
    id: 'dev-1',
    deviceId: 'NEXUS-7F3A9C',
    name: 'Potus de la sala',
    ownerId: 'user-1',
    complexId: 'complex-1',
    config: {},
    ...partial,
  }) as Device;

/** Repositorio en memoria: lo justo para el throttling. */
const buildHarness = () => {
  const alerts: DeviceAlert[] = [];
  const alertRepo = {
    findOne: jest.fn(({ where }: { where: Partial<DeviceAlert> }) =>
      Promise.resolve(
        [...alerts].reverse().find((a) => a.deviceUuid === where.deviceUuid && a.kind === where.kind) ?? null,
      ),
    ),
    create: jest.fn((d: Partial<DeviceAlert>) => d as DeviceAlert),
    save: jest.fn((a: DeviceAlert) => {
      alerts.push({ ...a, createdAt: reloj.ahora });
      return Promise.resolve(a);
    }),
  };
  const reloj = { ahora: new Date('2026-10-24T15:00:00Z') };
  const notifications = { dispatchPushOnly: jest.fn(() => Promise.resolve()) };
  const sockets = { toUser: jest.fn(), toComplexAdmins: jest.fn() };
  const dispatcher = new DeviceAlertDispatcher(
    alertRepo as never,
    loadIotConfig({}),
    notifications as unknown as NotificationsService,
    sockets as unknown as IotSocketEmitter,
  );
  return { dispatcher, notifications, sockets, alerts, reloj };
};

describe('DeviceAlertDispatcher', () => {
  it('criterio 3: 10 lecturas seguidas con sed = 1 sola push', async () => {
    const h = buildHarness();
    const device = deviceOf();
    const resultados: string[] = [];
    for (let i = 0; i < 10; i++) {
      // una lectura por minuto (matera con USB)
      h.reloj.ahora = new Date(Date.parse('2026-10-24T15:00:00Z') + i * 60_000);
      resultados.push(await h.dispatcher.dispatch(device, 'thirsty', { soil: 20, tankHasWater: true }, h.reloj.ahora));
    }
    expect(h.notifications.dispatchPushOnly).toHaveBeenCalledTimes(1);
    expect(resultados.filter((r) => r === 'sent')).toHaveLength(1);
    expect(resultados.filter((r) => r === 'throttled')).toHaveLength(9);
  });

  it('pasadas 6 h vuelve a avisar', async () => {
    const h = buildHarness();
    const device = deviceOf();
    await h.dispatcher.dispatch(device, 'thirsty', { soil: 20, tankHasWater: true }, h.reloj.ahora);
    h.reloj.ahora = new Date(h.reloj.ahora.getTime() + 6 * 3600_000 + 1000);
    expect(await h.dispatcher.dispatch(device, 'thirsty', { soil: 20, tankHasWater: true }, h.reloj.ahora)).toBe('sent');
    expect(h.notifications.dispatchPushOnly).toHaveBeenCalledTimes(2);
  });

  it('el throttling es por tipo: sed y depósito vacío son independientes', async () => {
    const h = buildHarness();
    const device = deviceOf();
    await h.dispatcher.dispatch(device, 'thirsty', { soil: 20, tankHasWater: false }, h.reloj.ahora);
    expect(await h.dispatcher.dispatch(device, 'tank_empty', { soil: 20, tankHasWater: false }, h.reloj.ahora)).toBe(
      'sent',
    );
  });

  it('horas de silencio: no hay push ni registro (sale con la primera lectura después)', async () => {
    const h = buildHarness();
    const device = deviceOf({ config: { quietHours: { start: '22:00', end: '07:00' } } });
    const nocheBogota = new Date('2026-10-24T04:00:00Z'); // 23:00 en Bogotá
    expect(await h.dispatcher.dispatch(device, 'thirsty', { soil: 20, tankHasWater: true }, nocheBogota)).toBe('quiet');
    expect(h.notifications.dispatchPushOnly).not.toHaveBeenCalled();
    expect(h.alerts).toHaveLength(0);
  });

  it('sin dueño no se avisa a nadie', async () => {
    const h = buildHarness();
    expect(await h.dispatcher.dispatch(deviceOf({ ownerId: null }), 'thirsty')).toBe('no_owner');
    expect(h.sockets.toUser).not.toHaveBeenCalled();
  });

  it('a la administración solo si el dueño lo activó', async () => {
    const h = buildHarness();
    await h.dispatcher.dispatch(deviceOf({ config: { notifyComplexAdmins: true } }), 'tank_empty');
    expect(h.sockets.toComplexAdmins).toHaveBeenCalledTimes(1);
    const h2 = buildHarness();
    await h2.dispatcher.dispatch(deviceOf(), 'tank_empty');
    expect(h2.sockets.toComplexAdmins).not.toHaveBeenCalled();
  });
});
