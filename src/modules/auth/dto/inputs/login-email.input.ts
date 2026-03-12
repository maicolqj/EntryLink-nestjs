import { InputType, Field } from '@nestjs/graphql';
import { IsEmail, IsNotEmpty, IsString, MinLength, MaxLength, IsBoolean } from 'class-validator';

@InputType({ description: 'Credenciales para inicio de sesión con email y contraseña' })
export class LoginEmailInput {
  @Field(() => String, { description: 'Correo electrónico del usuario' })
  @IsEmail({}, { message: 'El correo electrónico no tiene un formato válido' })
  @IsNotEmpty({ message: 'El correo electrónico es obligatorio' })
  email: string;

  @Field(() => String, { description: 'Contraseña del usuario' })
  @IsString()
  @IsNotEmpty({ message: 'La contraseña es obligatoria' })
  @MinLength(8, { message: 'La contraseña debe tener mínimo 8 caracteres' })
  @MaxLength(128, { message: 'La contraseña no puede superar 128 caracteres' })
  password: string;

  @Field(() => Boolean, { nullable: true, description: 'Mantener sesión activa por más tiempo' })
  @IsBoolean()
  rememberMe?: boolean;
}
