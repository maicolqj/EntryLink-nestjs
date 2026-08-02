import { InputType, Field } from '@nestjs/graphql';
import { IsNotEmpty, IsString, Matches } from 'class-validator';
import { Transform } from 'class-transformer';

@InputType({ description: 'Credenciales de login con la clave de acceso del residente' })
export class LoginAccessCodeInput {
  // El dispositivo NO viaja en el input: se toma del header `x-device-id` y se
  // amarra al fingerprint HMAC del servidor, que el cliente no puede fabricar.
  // La clave sola no abre sesión en un equipo que no esté vinculado.
  @Field(() => String, { description: 'Clave alfanumérica de 6 caracteres' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty({ message: 'La clave es obligatoria' })
  @Matches(/^[a-zA-Z0-9]{6}$/, { message: 'La clave debe ser de 6 caracteres alfanuméricos' })
  code: string;
}
