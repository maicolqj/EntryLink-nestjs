import { ObjectType, InputType, Field, Int } from '@nestjs/graphql';
import { IsOptional, IsBoolean, IsInt, IsArray, IsString, IsEnum, Min } from 'class-validator';
import { Type } from 'class-transformer';

import { UnitType } from '../../../residential-complex/enums/unit-type.enum';

@ObjectType()
export class FeeConfigTargetRules {
  @Field(() => Boolean, { nullable: true })
  excludeFloor1?: boolean;

  @Field(() => Int, { nullable: true })
  floorMin?: number;

  @Field(() => Int, { nullable: true })
  floorMax?: number;

  @Field(() => [String], { nullable: true })
  buildingIds?: string[];

  @Field(() => [String], { nullable: true })
  unitTypes?: string[];
}

@InputType()
export class FeeConfigTargetRulesInput {
  @Field(() => Boolean, { nullable: true })
  @IsOptional()
  @IsBoolean()
  excludeFloor1?: boolean;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  floorMin?: number;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  floorMax?: number;

  @Field(() => [String], { nullable: true })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  buildingIds?: string[];

  @Field(() => [String], { nullable: true })
  @IsOptional()
  @IsArray()
  @IsEnum(UnitType, { each: true })
  unitTypes?: string[];
}
