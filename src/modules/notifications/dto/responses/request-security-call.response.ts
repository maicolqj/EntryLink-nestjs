import { ObjectType, Field } from '@nestjs/graphql';

@ObjectType()
export class RequestSecurityCallResult {
  /** true si la solicitud se despachó a al menos un guardia de seguridad. */
  @Field()
  success: boolean;

  /** Mensaje informativo (p.ej. cuando no hay personal de seguridad activo). */
  @Field(() => String, { nullable: true })
  message?: string;
}
