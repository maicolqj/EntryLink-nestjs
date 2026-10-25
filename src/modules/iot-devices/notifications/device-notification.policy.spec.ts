import { buildNotifyPayload, decideDelivery } from './device-notification.policy';
import { DeviceNotificationType } from '../entities/device-notification-type.iot-entity';

const tipo = (partial: Partial<DeviceNotificationType> = {}): DeviceNotificationType =>
  ({
    key: 'PACKAGE',
    title: 'Paquete en portería',
    icon: 'package',
    ledColor: '#2E7DFF',
    ledPattern: 'pulse',
    sound: 'two_beep',
    priority: 50,
    interrupts: true,
    mandatory: false,
    requiresPowered: false,
    ttlSec: 20,
    deliveryTtlSec: 14400,
    urgent: false,
    entrylinkTypes: ['PACKAGE_RECEIVED'],
    ...partial,
  }) as DeviceNotificationType;

/**
 * PARTE H, criterios 9 y 10: un obligatorio no se apaga, el silencio no calla
 * el pánico, y con batería (no conectado) el aviso va a la cola en lugar de
 * prometerse en tiempo real.
 */
describe('decideDelivery', () => {
  const base = { mandatory: false, enabled: undefined, quiet: false, connected: true };

  it('conectado (USB) → ahora', () => {
    expect(decideDelivery(tipo(), base)).toBe('now');
  });

  it('dormido con batería → cola (llega al despertar si no caducó)', () => {
    expect(decideDelivery(tipo(), { ...base, connected: false })).toBe('queue');
  });

  it('PANIC (requiresPowered) con batería tampoco es tiempo real: va a la cola', () => {
    const panico = tipo({ key: 'PANIC', mandatory: true, requiresPowered: true, urgent: true });
    expect(decideDelivery(panico, { ...base, mandatory: true, connected: false })).toBe('queue');
    expect(decideDelivery(panico, { ...base, mandatory: true, connected: true })).toBe('now');
  });

  it('desactivado por el residente → no se envía, salvo que sea obligatorio', () => {
    expect(decideDelivery(tipo(), { ...base, enabled: false })).toBe('skip_disabled');
    expect(decideDelivery(tipo(), { ...base, enabled: false, mandatory: true })).toBe('now');
  });

  it('horas de silencio: calla lo normal, nunca lo urgente', () => {
    expect(decideDelivery(tipo(), { ...base, quiet: true })).toBe('skip_quiet');
    expect(decideDelivery(tipo({ urgent: true }), { ...base, quiet: true })).toBe('now');
  });
});

describe('buildNotifyPayload', () => {
  it('arma el JSON que espera el firmware (CONTRATO_REAL.md §5)', () => {
    expect(buildNotifyPayload(tipo(), 'n-1', 'Llegó un paquete de Servientrega')).toEqual({
      id: 'n-1',
      kind: 'PACKAGE',
      title: 'Llegó un paquete de Servientrega',
      icon: 'package',
      led: { color: '#2E7DFF', pattern: 'pulse' },
      sound: 'two_beep',
      interrupts: true,
      ttlSec: 20,
    });
  });

  it('título a 47 caracteres (pantalla) y ttlSec dentro de 1-300', () => {
    const p = buildNotifyPayload(tipo({ ttlSec: 999 }), 'n-2', 'x'.repeat(80));
    expect((p.title as string).length).toBe(47);
    expect(p.ttlSec).toBe(300);
  });

  it('sin título usa el del catálogo', () => {
    expect(buildNotifyPayload(tipo(), 'n-3').title).toBe('Paquete en portería');
  });
});
