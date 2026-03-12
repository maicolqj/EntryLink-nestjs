import { InputType, Field } from "@nestjs/graphql";
import { Type } from "class-transformer";
import { IsOptional } from "class-validator";

import { RolesFiltersInput } from "./roles-filter.input";
import { PaginationInput, SortInput } from "../../../shared/dto/inputs";

@InputType()
export class SearchRolesInput {
  @Field(() => RolesFiltersInput, { nullable: true })
  @IsOptional()
  @Type(() => RolesFiltersInput)
  filters?: RolesFiltersInput;

  @Field(() => PaginationInput, { nullable: true })
  @IsOptional()
  @Type(() => PaginationInput)
  pagination?: PaginationInput;

  @Field(() => SortInput, { nullable: true })
  @IsOptional()
  @Type(() => SortInput)
  sort?: SortInput;
}