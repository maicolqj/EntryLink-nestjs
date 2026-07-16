import { InputType, Field } from '@nestjs/graphql';
import { IsString, IsUUID, MinLength } from 'class-validator';

@InputType({ description: 'Datos para que un administrador restablezca la contraseña de un miembro del personal' })
export class AdminResetUserPasswordInput {
  @Field(() => String, { description: 'ID del usuario (personal) al que se le restablece la contraseña' })
  @IsUUID('4')
  userId: string;

  @Field(() => String, { description: 'Nueva contraseña asignada por el administrador' })
  @IsString()
  @MinLength(8)
  newPassword: string;
}
