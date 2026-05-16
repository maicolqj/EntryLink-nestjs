import { ObjectType, Field } from '@nestjs/graphql';

@ObjectType({ description: 'Respuesta con el token QR generado y su fecha de expiración' })
export class QrLoginTokenResponse {
  @Field(() => String, { description: 'Token UUID de un solo uso para el login por QR' })
  token: string;

  @Field(() => Date, { description: 'Fecha y hora de expiración del token (72 horas)' })
  expiresAt: Date;

  @Field(() => String, { description: 'PIN de 4 dígitos (últimos 4 del NIT sin dígito de verificación). El complejo ya lo conoce.' })
  pin: string;
}