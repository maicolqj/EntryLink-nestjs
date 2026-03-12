import { InputType, Field, PartialType } from '@nestjs/graphql';
import { IsUUID } from 'class-validator';
import { CreateComplexInput } from './create-complex.input';

@InputType()
export class UpdateComplexInput extends PartialType(CreateComplexInput) {

  @Field(() => String, { description: 'ID del complejo a actualizar' })
  @IsUUID()
  id: string;
}
