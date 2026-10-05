import { InputType, Field } from '@nestjs/graphql';
import { IsNotEmpty, IsString, Matches, MinLength } from 'class-validator';

/**
 * La contraseña propia que reemplaza a la inicial que asignó el
 * administrador. No pide la actual: la sesión se abrió con ella hace un
 * momento, y la operación solo procede si la cuenta está marcada para
 * cambiarla.
 */
@InputType()
export class CompleteRequiredPasswordChangeInput {
  @Field(() => String, { description: 'Nueva contraseña' })
  @IsNotEmpty({ message: 'La nueva contraseña es requerida' })
  @IsString()
  @MinLength(8, {
    message: 'La nueva contraseña debe tener al menos 8 caracteres',
  })
  @Matches(
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&.+-])[A-Za-z\d@$!%*?&.+-]+$/,
    {
      message:
        'La contraseña debe tener mayúsculas, minúsculas, números y un carácter especial (@$!%*?&.+-)',
    },
  )
  newPassword: string;
}
