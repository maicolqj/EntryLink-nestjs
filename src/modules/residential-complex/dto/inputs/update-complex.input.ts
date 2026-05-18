import { InputType, Field, PartialType } from '@nestjs/graphql';
import { IsUUID, IsOptional, IsString } from 'class-validator';
import { CreateComplexInput } from './create-complex.input';

@InputType()
export class UpdateComplexInput extends PartialType(CreateComplexInput) {

  @Field(() => String, { description: 'ID del complejo a actualizar' })
  @IsUUID()
  id: string;

  @Field(() => String, { nullable: true, description: 'ID (UUID) del nuevo representante legal. Enviar "" o null para limpiar.' })
  @IsOptional()
  @IsString()
  legalRepresentativeId?: string;
}
