import { InputType, Field } from "@nestjs/graphql";
import { Type } from "class-transformer";
import { IsOptional, IsEnum, IsBoolean } from "class-validator";
import { PermissionLevel } from "../../enums/level-permissions";
import { DateRangeInput } from "../../../shared/dto/inputs";


@InputType()
export class PermissionFiltersInput {
  @Field(() => Boolean, { nullable: true })
  @IsOptional()
  status?: boolean;

  @Field(() => PermissionLevel, { nullable: true })
  @IsOptional()
  @IsEnum(PermissionLevel)
  level?: PermissionLevel;

  @Field({ nullable: true })
  @IsOptional()
  @IsBoolean()
  isSystem?: boolean;

  @Field(() => String, { nullable: true })
  @IsOptional()
  category?: string;

  @Field({ nullable: true })
  @IsOptional()
  hasDependentPermissions?: boolean;

  @Field(() => DateRangeInput, { nullable: true })
  @IsOptional()
  @Type(() => DateRangeInput)
  createdAt?: DateRangeInput;

  @Field({ nullable: true })
  @IsOptional()
  search?: string; // Para búsqueda general por nombre o descripción
}