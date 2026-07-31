import { InputType, Field } from '@nestjs/graphql';
import { IsNotEmpty, IsString, Matches } from 'class-validator';

@InputType({ description: 'Credenciales de login por dispositivo vinculado + PIN (residentes)' })
export class LoginDevicePinInput {
  // El dispositivo NO viaja en el input: se toma del header `x-device-id` y se
  // amarra al fingerprint HMAC del servidor, que el cliente no puede fabricar.
  @Field(() => String, { description: 'PIN de 6 dígitos del dispositivo vinculado' })
  @IsString()
  @IsNotEmpty({ message: 'El PIN es obligatorio' })
  @Matches(/^\d{6}$/, { message: 'El PIN debe ser exactamente 6 dígitos' })
  pin: string;
}
