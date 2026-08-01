import { ObjectType, Field, ID } from '@nestjs/graphql';

@ObjectType({ description: 'Solicitud de ingreso pendiente de aprobación desde un dispositivo confiable' })
export class DeviceApprovalResponse {
  // Secreto del dispositivo solicitante: no viaja en el push y es lo único que
  // canjea la sesión. Guardarlo en memoria, no mostrarlo en pantalla.
  @Field(() => ID, { description: 'Identificador del intento. Requerido para consultar estado y canjear' })
  challengeId: string;

  @Field(() => String, {
    description:
      'Código a MOSTRAR en pantalla. El residente debe verificar que coincida con el del push antes de aprobar',
  })
  approvalCode: string;

  @Field(() => Date)
  expiresAt: Date;

  @Field(() => String, { description: 'Texto a mostrar al usuario mientras espera la aprobación' })
  instructions: string;
}
