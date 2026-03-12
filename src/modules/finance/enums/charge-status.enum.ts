import { registerEnumType } from '@nestjs/graphql';

export enum ChargeStatus {
  PENDING         = 'PENDING',          // Generado, aún no vencido
  OVERDUE         = 'OVERDUE',          // Fecha de vencimiento pasada sin pago total
  PARTIALLY_PAID  = 'PARTIALLY_PAID',   // Pago parcial recibido
  PAID            = 'PAID',             // Pagado en su totalidad
  CANCELLED       = 'CANCELLED',        // Anulado por el administrador
  WAIVED          = 'WAIVED',           // Exonerado (ej. exención de cuota)
}

registerEnumType(ChargeStatus, {
  name: 'ChargeStatus',
  description: 'Estado de un cargo (cuota) de una unidad',
});
