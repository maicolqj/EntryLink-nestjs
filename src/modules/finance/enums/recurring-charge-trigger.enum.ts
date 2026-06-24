import { registerEnumType } from '@nestjs/graphql';

/** Cómo se asigna un cobro recurrente a las unidades. */
export enum RecurringChargeTrigger {
  /** Asignación manual/segmentada (administración, ascensor, etc.). */
  MANUAL = 'MANUAL',
  /** Por vehículo: un cargo por cada vehículo ACTIVO de la unidad. */
  VEHICLE = 'VEHICLE',
}

registerEnumType(RecurringChargeTrigger, {
  name: 'RecurringChargeTrigger',
  description: 'Mecanismo de asignación de un cobro recurrente',
});
