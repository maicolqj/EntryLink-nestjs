import { InputType, Field, PartialType } from '@nestjs/graphql';
import { IsUUID } from 'class-validator';
import { CreateBuildingInput } from './create-building.input';

@InputType()
export class UpdateBuildingInput extends PartialType(CreateBuildingInput) {
  @Field(() => String, { description: 'ID de la torre a actualizar' })
  @IsUUID()
  id: string;
}
