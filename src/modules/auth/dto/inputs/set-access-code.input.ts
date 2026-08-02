import { InputType, Field } from '@nestjs/graphql';
import { IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';

const normalizeText = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

@InputType({ description: 'Fija o cambia la clave de acceso del residente autenticado' })
export class SetAccessCodeInput {
  // La regla de "clave no obvia" vive en el service (assertCodeIsAcceptable)
  // para que valga igual si algún día entra por otra vía; aquí solo el formato.
  // Se acepta minúscula y el service normaliza a mayúsculas.
  @Field(() => String, { description: 'Clave alfanumérica de 6 caracteres' })
  @Transform(normalizeText)
  @IsString()
  @IsNotEmpty({ message: 'La clave es obligatoria' })
  @Matches(/^[a-zA-Z0-9]{6}$/, { message: 'La clave debe ser de 6 caracteres alfanuméricos' })
  code: string;

  @Field(() => String, { nullable: true, description: 'Nombre del dispositivo (ej. "iPhone de Juan")' })
  @Transform(normalizeText)
  @IsOptional()
  @IsString()
  @MaxLength(120)
  label?: string;
}
