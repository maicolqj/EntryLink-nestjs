import { registerEnumType } from '@nestjs/graphql';

/**
 * Estado de validación del DPA (Anexo B2B) firmado que sube el complejo:
 *  - PENDING:  subido, a la espera de revisión del SUPER_ADMIN.
 *  - APPROVED: revisado y aceptado; el complejo deja de verlo como pendiente.
 *  - REJECTED: revisado y rechazado; el complejo debe subir uno nuevo
 *              (se le notifica con el motivo del rechazo).
 */
export enum DpaValidationStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

registerEnumType(DpaValidationStatus, {
  name: 'DpaValidationStatus',
  description: 'Estado de validación del DPA firmado subido por un complejo',
});
