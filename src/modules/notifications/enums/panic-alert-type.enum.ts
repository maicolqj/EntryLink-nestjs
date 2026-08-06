import { registerEnumType } from '@nestjs/graphql';

/**
 * Naturaleza de la emergencia.
 *
 * Hoy el botón de pánico siempre emite PANIC; los demás valores existen para
 * que agregar un selector de tipo en la app no obligue a migrar la tabla.
 *
 * OJO: es un enum nativo de Postgres y el proyecto corre synchronize:false, así
 * que cualquier valor nuevo necesita su migración `ALTER TYPE ... ADD VALUE`.
 * Sin ella el INSERT falla en runtime y, si el llamador traga el error, la
 * alerta se pierde en silencio.
 */
export enum PanicAlertType {
  PANIC     = 'PANIC',
  MEDICAL   = 'MEDICAL',
  FIRE      = 'FIRE',
  INTRUSION = 'INTRUSION',
}

registerEnumType(PanicAlertType, {
  name: 'PanicAlertType',
  description: 'Tipo de emergencia de una alerta de pánico',
});
