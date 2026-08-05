import { ObjectType, Field, Int } from '@nestjs/graphql';

/** Resultado de disparar una prueba de humo de push. */
@ObjectType()
export class PushHealthCheckResult {

  /** Id de la fila de salud; el cliente lo usa para consultar el resultado. */
  @Field()
  healthId: string;

  @Field()
  sentAt: Date;
}

/** Estado de entrega de un dispositivo, para el wizard y el banner de la app. */
@ObjectType()
export class DevicePushHealthStatus {

  @Field()
  healthId: string;

  /**
   * false tras varias pruebas seguidas sin respuesta. Es lo que dispara el
   * banner rojo bloqueante en el arranque de la app.
   */
  @Field()
  isHealthy: boolean;

  /**
   * true cuando la última prueba enviada SÍ fue confirmada. El wizard espera
   * exactamente esto para dar por superado el paso final; `isHealthy` no sirve
   * porque arranca en true antes de haber probado nada.
   */
  @Field()
  lastCheckAcknowledged: boolean;

  @Field(() => Date, { nullable: true })
  lastTestSentAt?: Date;

  @Field(() => Date, { nullable: true })
  lastTestAckAt?: Date;

  @Field(() => Int)
  consecutiveFailures: number;

  @Field(() => Date, { nullable: true })
  onboardingCompletedAt?: Date;
}
