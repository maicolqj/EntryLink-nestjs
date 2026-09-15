import { registerEnumType } from '@nestjs/graphql';

/**
 * Recorrido de un reporte. El orden importa porque es el que hace defendible
 * la sanción:
 *
 *   REPORTED ──desestimado──▶ DISMISSED
 *      │
 *      └──validado──▶ UNDER_DEFENSE ──▶ WARNED | FINED | DISMISSED
 *
 * Mientras está en REPORTED la unidad señalada NO se entera: un reporte sin
 * revisar es la palabra de un vecino contra otro, y avisarle a la unidad en ese
 * momento convierte el módulo en un ring. Solo cuando la administración lo
 * valida se le notifica y se le abre la ventana de descargos (Ley 675 art. 59:
 * sanción sin oír al implicado es anulable).
 */
export enum PetIncidentStatus {
  REPORTED = 'REPORTED', // Radicado, pendiente de revisión de la administración
  UNDER_DEFENSE = 'UNDER_DEFENSE', // Validado y notificado: corre el plazo de descargos
  DISMISSED = 'DISMISSED', // Desestimado (sin mérito o con descargos aceptados)
  WARNED = 'WARNED', // Terminó en llamado de atención
  FINED = 'FINED', // Terminó en multa cargada a la unidad
}

registerEnumType(PetIncidentStatus, {
  name: 'PetIncidentStatus',
  description: 'Estado del reporte de convivencia',
  valuesMap: {
    REPORTED: { description: 'Pendiente de revisión' },
    UNDER_DEFENSE: { description: 'Notificado, en plazo de descargos' },
    DISMISSED: { description: 'Desestimado' },
    WARNED: { description: 'Resuelto con llamado de atención' },
    FINED: { description: 'Resuelto con multa' },
  },
});
