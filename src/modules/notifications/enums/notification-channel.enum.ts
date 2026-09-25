import { registerEnumType } from '@nestjs/graphql';

/**
 * Desde dónde se está leyendo la bandeja.
 *
 * El rol de la sesión no alcanza para decidirlo: el super admin o la
 * administradora que además viven en un conjunto tienen RESIDENT_ROL como rol
 * base (ver ROLES_WITH_RESIDENT_BASE), y sus avisos de residente —el paquete
 * que les llegó, la cuota del mes— se mezclaban en el panel con los del
 * sistema. Lo que separa un sombrero del otro es la pantalla: el panel web es
 * operación, la app es la vida en la unidad.
 */
export enum NotificationChannel {
  /** Panel web de administración: sin los avisos de audiencia RESIDENT. */
  PANEL = 'PANEL',
  /** App: sin filtro por canal (el alcance de la sesión ya decide). */
  APP = 'APP',
}

registerEnumType(NotificationChannel, {
  name: 'NotificationChannel',
  description: 'Pantalla desde la que se lee la bandeja',
});
