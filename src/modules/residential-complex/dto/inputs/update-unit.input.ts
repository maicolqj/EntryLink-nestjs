import { InputType, Field, PartialType, OmitType } from '@nestjs/graphql';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { CreateUnitInput } from './create-unit.input';
import { UnitStatus }     from '../../enums/unit-status.enum';

@InputType()
export class UpdateUnitInput extends PartialType(
  OmitType(CreateUnitInput, ['complexId', 'buildingId'] as const),
) {
  @Field(() => String, { description: 'ID de la unidad a actualizar' })
  @IsUUID()
  id: string;

  @Field(() => UnitStatus, { nullable: true, description: 'Cambiar estado de la unidad' })
  @IsOptional()
  @IsEnum(UnitStatus)
  status?: UnitStatus;
}
