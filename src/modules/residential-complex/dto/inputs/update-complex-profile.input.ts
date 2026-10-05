import { InputType, Field } from '@nestjs/graphql';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

/**
 * Lo único que la administración del conjunto (COMPLEX_ROL) puede cambiar de
 * su propio conjunto: el teléfono y el sitio web, que ven los residentes en Mi
 * Conjunto y usan sus botones Llamar y Sitio web.
 *
 * Todo lo demás lo corrige el SUPER_ADMIN:
 *  - dirección, ciudad, departamento y descripción no cambian en la vida de un
 *    conjunto, y la dirección además ubica el conjunto en el mapa;
 *  - el correo es el usuario con el que la cuenta del complejo inicia sesión;
 *  - nombre, NIT, tipo, plan y módulos son del contrato.
 *
 * Cadena vacía = quitar el dato.
 */
@InputType()
export class UpdateComplexProfileInput {
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
