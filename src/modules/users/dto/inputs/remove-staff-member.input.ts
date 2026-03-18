import { InputType, Field } from '@nestjs/graphql';
import { IsNotEmpty, IsUUID } from 'class-validator';

@InputType({ description: 'Datos para eliminar un miembro del personal del complejo' })
export class RemoveStaffMemberInput {
  @Field(() => String, { description: 'ID del usuario a eliminar del personal' })
  @IsUUID('4')
  @IsNotEmpty()
  userId: string;

  @Field(() => String, { description: 'ID del complejo del que se elimina al personal' })
  @IsUUID('4')
  @IsNotEmpty()
  complexId: string;
}
