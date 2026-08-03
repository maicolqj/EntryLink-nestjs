import { InputType, Field } from '@nestjs/graphql';
import { IsNotEmpty, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';

@InputType({ description: 'Credenciales de login con la clave de acceso del residente' })
export class LoginAccessCodeInput {
  // El dispositivo NO viaja en el input: se toma del header `x-device-id` y se
  // amarra al fingerprint HMAC del servidor, que el cliente no puede fabricar.
  @Field(() => String, { description: 'Clave alfanumérica de 6 caracteres' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty({ message: 'La clave es obligatoria' })
  @Matches(/^[a-zA-Z0-9]{6}$/, { message: 'La clave debe ser de 6 caracteres alfanuméricos' })
  code: string;

  /**
   * Documento del residente. Solo hace falta cuando el equipo todavía no está
   * vinculado: sin él, el servidor no tiene con quién comparar la clave y el
   * residente que reinstaló la app en su único celular se queda sin camino de
   * vuelta. Desde un equipo ya vinculado se ignora.
   */
  @Field(() => String, {
    nullable: true,
    description:
      'Documento del residente. Obligatorio solo cuando el x-device-id todavía no está vinculado; ' +
      'desde un equipo vinculado el servidor lo ignora.',
  })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsOptional()
  @IsString()
  @Length(6, 20, { message: 'El documento debe tener entre 6 y 20 caracteres' })
  identity?: string;

  /** Nombre visible del equipo que se vincula en este ingreso. */
  @Field(() => String, {
    nullable: true,
    description: 'Nombre del dispositivo que se vincula en este ingreso (ej. "Mi Android")',
  })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsOptional()
  @IsString()
  @MaxLength(120)
  label?: string;
}
