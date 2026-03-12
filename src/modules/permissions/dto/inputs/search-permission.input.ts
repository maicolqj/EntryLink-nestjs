import { InputType, Field } from "@nestjs/graphql";
import { Type } from "class-transformer";
import { IsOptional } from "class-validator";
import { PaginationInput, SortInput } from "../../../shared/dto/inputs";
import { PermissionFiltersInput } from "./permission-filter.input";

@InputType()
export class SearchPermissionsInput {
  @Field(() => PermissionFiltersInput, { nullable: true })
  @IsOptional()
  @Type(() => PermissionFiltersInput)
  filters?: PermissionFiltersInput;

  @Field(() => PaginationInput, { nullable: true })
  @IsOptional()
  @Type(() => PaginationInput)
  pagination?: PaginationInput;

  @Field(() => SortInput, { nullable: true })
  @IsOptional()
  @Type(() => SortInput)
  sort?: SortInput;
}