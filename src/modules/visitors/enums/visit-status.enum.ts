import { registerEnumType } from '@nestjs/graphql';

export enum VisitStatus {
  PENDING_APPROVAL = 'PENDING_APPROVAL', // Esperando respuesta del residente
  APPROVED         = 'APPROVED',         // Aprobada — puede ingresar
  DENIED           = 'DENIED',           // Rechazada por el residente
  INSIDE           = 'INSIDE',           // Actualmente dentro del complejo
  COMPLETED        = 'COMPLETED',        // Salió — visita finalizada
  CANCELLED        = 'CANCELLED',        // Cancelada antes de ingresar
  EXPIRED          = 'EXPIRED',          // El QR o la autorización venció
  NO_SHOW          = 'NO_SHOW',          // Cita programada y el visitante no llegó
}

registerEnumType(VisitStatus, {
  name: 'VisitStatus',
  description: 'Estado actual de la visita',
});
