import { ObjectType, Field } from '@nestjs/graphql';
import { DeviceApprovalStatus } from '../../enums/device-approval-status.enum';

@ObjectType({ description: 'Estado de una solicitud de ingreso por aprobación push' })
export class DeviceApprovalStatusResponse {
  @Field(() => DeviceApprovalStatus, {
    description: 'PENDING mientras el residente no responde; APPROVED habilita el canje',
  })
  status: DeviceApprovalStatus;

  @Field(() => Date)
  expiresAt: Date;
}
