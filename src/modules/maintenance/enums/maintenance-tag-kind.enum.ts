import { registerEnumType } from '@nestjs/graphql';

export enum MaintenanceTagKind {
  QR = 'QR',
  NFC = 'NFC',
  /** El mismo punto tiene pegado el sticker QR y el TAG NFC. */
  BOTH = 'BOTH',
}

registerEnumType(MaintenanceTagKind, {
  name: 'MaintenanceTagKind',
  description: 'Soporte físico del punto de ubicación',
});
