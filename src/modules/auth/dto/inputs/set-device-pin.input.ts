import { InputType, Field } from '@nestjs/graphql';
import { IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';

const normalizeText = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

@InputType({ description: 'Fija el PIN del dispositivo actual para el residente autenticado' })
export class SetDevicePinInput {
  // La regla de "PIN no obvio" vive en el service (assertPinIsAcceptable) para
  // que valga igual si algún día entra por otra vía; aquí solo el formato.
  @Field(() => String, { description: 'PIN de 6 dígitos' })
  @IsString()
  @IsNotEmpty({ message: 'El PIN es obligatorio' })
  @Matches(/^\d{6}$/, { message: 'El PIN debe ser exactamente 6 dígitos' })
  pin: string;

  @Field(() => String, { nullable: true, description: 'Nombre del dispositivo (ej. "iPhone de Juan")' })
  @Transform(normalizeText)
  @IsOptional()
  @IsString()
  @MaxLength(120)
  label?: string;
}
