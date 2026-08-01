import { ObjectType, Field, ID } from '@nestjs/graphql';

/**
 * Solicitud vista desde el dispositivo de confianza. Deliberadamente NO expone
 * el `challengeId`: quien aprueba no debe poder canjear la sesión.
 */
@ObjectType({ description: 'Solicitud de ingreso esperando que el residente la apruebe o rechace' })
export class PendingDeviceApproval {
  @Field(() => ID, { description: 'Identificador para aprobar o rechazar' })
  approvalId: string;

  @Field(() => String, { description: 'Código a comparar con el mostrado en el dispositivo que pide entrar' })
  approvalCode: string;

  @Field(() => String, { nullable: true, description: 'Equipo desde el que se pide el ingreso' })
  requestedFromLabel?: string;

  @Field(() => String, { nullable: true, description: 'IP de origen de la solicitud' })
  requestedFromIp?: string;

  @Field(() => Date)
  expiresAt: Date;

  @Field(() => Date)
  createdAt: Date;
}
