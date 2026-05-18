import { ObjectType, Field } from '@nestjs/graphql';

@ObjectType({ description: 'Respuesta al auto-registro de supervisor' })
export class RegisterSupervisorResponse {
  @Field(() => Boolean)
  success: boolean;

  @Field(() => String)
  message: string;

  @Field(() => String, { nullable: true, description: 'ID del supervisor creado; null si hubo error o el correo ya existe' })
  supervisorId?: string | null;
}
