import { InputType, Field } from '@nestjs/graphql';
import { IsString, MinLength, Matches } from 'class-validator';

@InputType()
export class ResetPasswordInput {
  @Field(() => String, { description: 'Token de restablecimiento recibido por email' })
  @IsString()
  token: string;

  @Field(() => String, { description: 'Nueva contraseña' })
  @IsString()
  @MinLength(8)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&.+\-])/, {
    message:
      'La contraseña debe tener al menos una mayúscula, una minúscula, un número y un carácter especial',
  })
  newPassword: string;
}
