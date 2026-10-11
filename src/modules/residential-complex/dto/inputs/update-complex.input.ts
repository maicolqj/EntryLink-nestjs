import { InputType, Field, PartialType } from '@nestjs/graphql';
import { IsUUID, IsOptional, IsString } from 'class-validator';
import { CreateComplexInput } from './create-complex.input';

/**
 * Sin los valores por defecto del alta: si no, GraphQL rellena country, type y
 * plan en cada edición parcial (el conjunto volvía a FREE y la cuenta del
 * complejo no podía guardar ni sus propios ajustes).
 */
@InputType()
export class UpdateComplexInput extends PartialType(CreateComplexInput, {
  omitDefaultValues: true,
}) {
  @Field(() => String, { description: 'ID del complejo a actualizar' })
  @IsUUID()
  id: string;

  @Field(() => String, {
    nullable: true,
    description:
      'ID (UUID) del nuevo representante legal. Enviar "" o null para limpiar.',
  })
  @IsOptional()
  @IsString()
  legalRepresentativeId?: string;
}
