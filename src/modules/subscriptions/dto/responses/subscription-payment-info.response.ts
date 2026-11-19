import { Field, Int, ObjectType } from '@nestjs/graphql';

/** Cómo pagar la suscripción: el QR de la plataforma y la cuenta. */
@ObjectType({ description: 'Datos para pagar la suscripción' })
export class SubscriptionPaymentInfo {
  @Field(() => String, { nullable: true })
  qrImageUrl?: string | null;

  @Field(() => String, {
    nullable: true,
    description: 'Cuenta, titular y lo que haga falta saber para pagar',
  })
  instructions?: string | null;

  @Field(() => Int, {
    description: 'Días antes del vencimiento desde los que se puede renovar',
  })
  renewalWindowDays: number;
}
