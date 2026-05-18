import { registerEnumType } from '@nestjs/graphql';

export enum AccessRequestStatus {
  PENDING  = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

registerEnumType(AccessRequestStatus, {
  name: 'AccessRequestStatus',
  description: 'Estado de la solicitud de acceso del supervisor al complejo',
});
