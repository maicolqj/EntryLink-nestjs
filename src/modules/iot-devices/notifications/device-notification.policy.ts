import type { DeviceNotificationType } from '../entities/device-notification-type.iot-entity';

/**
 * Decisión de entrega de un aviso de EntryLink a un aparato (PARTE H). Pura,
 * para poder probarla sin BD ni broker.
 *
 *  - Desactivado por el residente → no se envía (salvo obligatorio).
 *  - Horas de silencio → no se envía, salvo los urgentes (PANIC nunca se calla).
 *  - Conectado al broker → ahora (USB: tiempo real, PANIC incluido).
 *  - No conectado (batería dormida) → a la cola con `deliveryTtlSec`; llega al
 *    despertar si no caducó. Los `requiresPowered` (PANIC) NO se prometen en
 *    tiempo real con batería: su caducidad es corta a propósito.
 */
export type DeliveryDecision = 'now' | 'queue' | 'skip_disabled' | 'skip_quiet';

export interface DeliveryContext {
  /** Catálogo o regla del conjunto. */
  mandatory: boolean;
  /** Preferencia del residente; sin preferencia = activado. */
  enabled: boolean | undefined;
  quiet: boolean;
  connected: boolean;
}

export function decideDelivery(
  type: Pick<DeviceNotificationType, 'urgent'>,
  ctx: DeliveryContext,
): DeliveryDecision {
  if (!ctx.mandatory && ctx.enabled === false) return 'skip_disabled';
  if (ctx.quiet && !type.urgent) return 'skip_quiet';
  return ctx.connected ? 'now' : 'queue';
}

/** Lo que espera el firmware en .../notify (CONTRATO_REAL.md §5). */
export function buildNotifyPayload(
  type: DeviceNotificationType,
  id: string,
  title?: string | null,
): Record<string, unknown> {
  return {
    id,
    kind: type.key,
    // La pantalla admite 47 caracteres; el firmware pasa las tildes a ASCII
    title: (title || type.title).slice(0, 47),
    icon: type.icon,
    led: { color: type.ledColor, pattern: type.ledPattern },
    sound: type.sound,
    interrupts: type.interrupts,
    ttlSec: Math.min(Math.max(type.ttlSec, 1), 300),
  };
}
