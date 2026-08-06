export const PANIC_ESCALATION_QUEUE = 'panic-escalation';

export const PANIC_ESCALATION_JOBS = {
  ESCALATE: 'escalate',
} as const;

export interface PanicEscalationJobPayload {
  panicAlertId: string;
  complexId:    string;
  /** Nivel que este job debe ejecutar: 1, 2 o 3. */
  level:        number;
}

/**
 * ID determinista del job.
 *
 * Sirve para dos cosas: que un doble encolado del mismo nivel no duplique el
 * escalamiento (BullMQ ignora un jobId ya existente), y que reconocer la alerta
 * pueda eliminar el job pendiente por nombre en vez de recorrer la cola.
 */
export function panicEscalationJobId(panicAlertId: string, level: number): string {
  return `panic:${panicAlertId}:L${level}`;
}
