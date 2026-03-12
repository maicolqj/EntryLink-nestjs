import { InputType, Field, PartialType, OmitType } from '@nestjs/graphql';
import { IsUUID } from 'class-validator';
import { CreateBuildingInput } from './create-building.input';

@InputType()
export class UpdateBuildingInput extends PartialType(
  OmitType(CreateBuildingInput, ['complexId'] as const),
) {
  @Field(() => String, { description: 'ID de la torre a actualizar' })
  @IsUUID()
  id: string;
}
