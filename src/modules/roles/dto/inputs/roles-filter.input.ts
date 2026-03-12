import { InputType, Field, Int } from "@nestjs/graphql";
import { Type } from "class-transformer";
import { IsOptional, IsBoolean, IsInt } from "class-validator";
import { DateRangeInput } from "../../../shared/dto/inputs";

@InputType()
export class RolesFiltersInput {
  @Field(() => Boolean, { nullable: true })
  @IsOptional()
  status?: boolean;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  hierarchyLevel?: number;

  @Field({ nullable: true })
  @IsOptional()
  @IsBoolean()
  isSystem?: boolean;

  @Field(() => DateRangeInput, { nullable: true })
  @IsOptional()
  @Type(() => DateRangeInput)
  createdAt?: DateRangeInput;

  @Field({ nullable: true })
  @IsOptional()
  search?: string; // Para búsqueda general por nombre o descripción
}