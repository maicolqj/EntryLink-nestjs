import { InputType, Field } from '@nestjs/graphql';
import { IsUUID, IsEnum, IsString, IsNotEmpty, Length, Matches } from 'class-validator';
import { UserIdentityType } from '../../enums/user.enums';

@InputType({ description: 'Datos para editar el tipo y número de documento de identidad de un usuario' })
export class UpdateUserIdentityInput {
  @Field(() => String, { description: 'ID del usuario a editar' })
  @IsUUID()
  userId: string;

  @Field(() => UserIdentityType, { description: 'Tipo de documento de identidad' })
  @IsEnum(UserIdentityType)
  identityType: UserIdentityType;

  @Field(() => String, { description: 'Número de documento de identidad' })
  @IsString()
  @IsNotEmpty()
  @Length(3, 20)
  @Matches(/^[a-zA-Z0-9.\-]+$/, {
    message: 'El documento solo puede contener letras, números, puntos o guiones',
  })
  identity: string;
}
