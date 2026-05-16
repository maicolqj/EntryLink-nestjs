import { InputType, Field } from '@nestjs/graphql';
import { IsString, MinLength, Matches, IsNotEmpty, Length } from 'class-validator';

@InputType()
export class ResetPasswordInput {
  // VULN-10 fix: validar longitud y formato UUID para evitar payloads gigantes
  @Field(() => String)
  @IsString()
  @IsNotEmpty({ message: 'El token es obligatorio' })
  @Length(36, 36, { message: 'Formato de token inválido' })
  @Matches(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i, {
    message: 'Formato de token inválido',
  })
  token: string;

  @Field(() => String)
  @IsString()
  @MinLength(8)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&.+\-])/, {
    message: 'La contraseña debe contener al menos una mayúscula, una minúscula, un número y un carácter especial',
  })
  newPassword: string;
}
