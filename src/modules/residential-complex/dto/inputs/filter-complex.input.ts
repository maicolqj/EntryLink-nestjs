import { InputType, Field } from '@nestjs/graphql';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ComplexType }   from '../../enums/complex-type.enum';
import { ComplexPlan }   from '../../enums/complex-plan.enum';
import { ComplexStatus } from '../../enums/complex-status.enum';

@InputType()
export class FilterComplexInput {

  @Field(() => String, { nullable: true, description: 'Buscar por nombre, ciudad o dirección' })
  @IsOptional()
  @IsString()
  search?: string;

  @Field(() => ComplexType, { nullable: true })
  @IsOptional()
  @IsEnum(ComplexType)
  type?: ComplexType;

  @Field(() => ComplexPlan, { nullable: true })
  @IsOptional()
  @IsEnum(ComplexPlan)
  plan?: ComplexPlan;

  @Field(() => ComplexStatus, { nullable: true })
  @IsOptional()
  @IsEnum(ComplexStatus)
  status?: ComplexStatus;

  @Field(() => String, { nullable: true, description: 'Filtrar por ciudad' })
  @IsOptional()
  @IsString()
  city?: string;
}
