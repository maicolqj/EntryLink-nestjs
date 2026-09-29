import {
  PanicLocationService,
  PANIC_LOCATION_WINDOW_MS,
} from './panic-location.service';
import { PanicAlertStatus } from '../enums/panic-alert-status.enum';
import { SocketEvent } from '../../../core/infrastructure/socket/socket.events';
import { ValidRoles } from '../../roles/enums/valid-roles';

/**
 * Spec de la ubicación del pánico: quién la reporta, hasta cuándo y quién la
 * ve. Lo delicado no es guardar coordenadas sino no convertir una emergencia
 * en rastreo, ni mostrarle la posición de un vecino a quien no le llegó la
 * alarma.
 */

const COMPLEX_ID = 'complex-1';
const TRIGGER = 'user-trigger';

const alertRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'panic-1',
  complexId: COMPLEX_ID,
  triggeredByUserId: TRIGGER,
  status: PanicAlertStatus.PENDING,
  createdAt: new Date(),
  ...overrides,
});

const build = (row: Record<string, unknown> | null, received = false) => {
  const panicRepo = {
    findOne: jest.fn().mockResolvedValue(row),
    save: jest.fn((a: unknown) => Promise.resolve(a)),
  };
  const notifRepo = { exists: jest.fn().mockResolvedValue(received) };
  const socketService = { emitToComplex: jest.fn() };
  const service = new PanicLocationService(
    panicRepo as never,
    notifRepo as never,
    socketService as never,
  );
  return { service, panicRepo, notifRepo, socketService };
};

const input = {
  panicAlertId: 'panic-1',
  latitude: 4.6097102,
  longitude: -74.081749,
  accuracy: 12,
};

const user = (sub: string, roles: ValidRoles[], complexId?: string) =>
  ({ sub, roles, complexId }) as never;

describe('PanicLocationService — reportar', () => {
  it('guarda la ubicación y la emite a la sala del complejo', async () => {
    const h = build(alertRow());
    const saved = await h.service.report(
      input,
      user(TRIGGER, [ValidRoles.RESIDENT_ROL]),
    );

    expect(saved.latitude).toBe(input.latitude);
    expect(saved.locationCapturedAt).toBeInstanceOf(Date);
    expect(h.socketService.emitToComplex).toHaveBeenCalledWith(
      COMPLEX_ID,
      SocketEvent.PANIC_ALERT_LOCATION,
      expect.objectContaining({ alertId: 'panic-1', accuracy: 12 }),
    );
  });

  it('solo quien activó la alerta puede reportar su ubicación', async () => {
    const h = build(alertRow());
    await expect(
      h.service.report(input, user('otro', [ValidRoles.RESIDENT_ROL])),
    ).rejects.toThrow('Solo quien activó');
    expect(h.panicRepo.save).not.toHaveBeenCalled();
  });

  it('pasados 10 minutos ya no acepta ubicación: eso sería rastreo', async () => {
    const h = build(
      alertRow({
        createdAt: new Date(Date.now() - PANIC_LOCATION_WINDOW_MS - 1),
      }),
    );
    await expect(
      h.service.report(input, user(TRIGGER, [ValidRoles.RESIDENT_ROL])),
    ).rejects.toThrow('ya no recibe ubicación');
  });

  it('una alerta resuelta no recibe ubicación', async () => {
    const h = build(alertRow({ status: PanicAlertStatus.RESOLVED }));
    await expect(
      h.service.report(input, user(TRIGGER, [ValidRoles.RESIDENT_ROL])),
    ).rejects.toThrow('ya no recibe ubicación');
  });

  it('no cree una hora del equipo en el futuro', async () => {
    const h = build(alertRow());
    const future = new Date(Date.now() + 3_600_000).toISOString();
    const saved = await h.service.report(
      { ...input, capturedAt: future },
      user(TRIGGER, [ValidRoles.RESIDENT_ROL]),
    );
    expect(saved.locationCapturedAt?.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('una alerta que no existe responde no encontrada', async () => {
    const h = build(null);
    await expect(
      h.service.report(input, user(TRIGGER, [ValidRoles.RESIDENT_ROL])),
    ).rejects.toThrow('no existe');
  });
});

describe('PanicLocationService — consultar', () => {
  it('la portería del conjunto la ve', async () => {
    const h = build(alertRow());
    await expect(
      h.service.find(
        'panic-1',
        user('guard', [ValidRoles.SECURITY_ROL], COMPLEX_ID),
      ),
    ).resolves.toBeTruthy();
    expect(h.notifRepo.exists).not.toHaveBeenCalled();
  });

  it('la cuenta del complejo la ve (su sub es el id del complejo)', async () => {
    const h = build(alertRow());
    await expect(
      h.service.find('panic-1', user(COMPLEX_ID, [ValidRoles.COMPLEX_ROL])),
    ).resolves.toBeTruthy();
  });

  it('un residente al que le llegó la alarma la ve', async () => {
    const h = build(alertRow(), true);
    await expect(
      h.service.find(
        'panic-1',
        user('vecino', [ValidRoles.RESIDENT_ROL], COMPLEX_ID),
      ),
    ).resolves.toBeTruthy();
  });

  it('un residente del mismo conjunto al que NO le llegó no la ve', async () => {
    const h = build(alertRow(), false);
    await expect(
      h.service.find(
        'panic-1',
        user('otra-torre', [ValidRoles.RESIDENT_ROL], COMPLEX_ID),
      ),
    ).rejects.toThrow('No tienes acceso');
  });

  it('el personal de otro conjunto no la ve', async () => {
    const h = build(alertRow(), false);
    await expect(
      h.service.find(
        'panic-1',
        user('guard', [ValidRoles.SECURITY_ROL], 'otro'),
      ),
    ).rejects.toThrow('No tienes acceso');
  });
});
