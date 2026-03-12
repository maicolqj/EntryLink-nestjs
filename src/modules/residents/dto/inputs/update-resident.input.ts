import { InputType, Field, PartialType, OmitType } from '@nestjs/graphql';
import { IsUUID } from 'class-validator';
import { CreateResidentInput } from './create-resident.input';

@InputType()
export class UpdateResidentInput extends PartialType(
  OmitType(CreateResidentInput, ['userId', 'unitId', 'complexId'] as const),
) {
  @Field(() => String, { description: 'ID del registro de residente a actualizar' })
  @IsUUID()
  id: string;
}
