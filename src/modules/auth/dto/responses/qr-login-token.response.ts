import { ObjectType, Field } from '@nestjs/graphql';

@ObjectType({ description: 'Respuesta con el token QR generado y su fecha de expiración' })
export class QrLoginTokenResponse {
  @Field(() => String, { description: 'Token UUID de un solo uso para el login por QR' })
  token: string;

  @Field(() => Date, { description: 'Fecha y hora de expiración del token (72 horas)' })
  expiresAt: Date;

  @Field(() => String, { description: 'PIN: últimos 4 dígitos del NIT base (antes del guion). El complejo ya lo conoce.' })
  pin: string;

}