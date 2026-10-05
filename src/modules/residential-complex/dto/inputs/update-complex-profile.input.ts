import { InputType, Field } from '@nestjs/graphql';
import {
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Lo que la administración del conjunto (COMPLEX_ROL) puede cambiar de su
 * propio conjunto: los datos de contacto y presentación que ven los
 * residentes en Mi Conjunto.
 *
 * Quedan fuera a propósito:
 *  - el correo, porque es el usuario con el que la cuenta del complejo inicia
 *    sesión: cambiarlo aquí le cambiaría el acceso sin verificar el nuevo;
 *  - nombre, NIT, tipo, plan y módulos, que son del contrato y los maneja el
 *    SUPER_ADMIN.
 *
 * Cadena vacía = quitar el dato (teléfono, sitio web, descripción).
 */
@InputType()
export class UpdateComplexProfileInput {
  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(255)
  address?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  city?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  state?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  @Matches(/^$|^\+?[\d\s()-]{7,30}$/, { message: 'El teléfono no es válido' })
  phoneNumber?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  @Matches(/^$|^(https?:\/\/)?[\w-]+(\.[\w-]+)+(\/\S*)?$/i, {
    message: 'El sitio web no es válido',
  })
  website?: string;
}
