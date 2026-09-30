import { ObjectType, Field } from '@nestjs/graphql';

@ObjectType()
export class TriggerPanicAlertResult {
  @Field()
  success: boolean;

  /**
   * La alerta creada. Con él la app reporta la ubicación en cuanto el GPS la
   * tenga, sin haber demorado el disparo.
   */
  @Field(() => String, { nullable: true })
  panicAlertId?: string;
}
