import { InputType, Field } from "@nestjs/graphql";
import { IsOptional, IsDateString } from "class-validator";

@InputType()
export class DateRangeInput {
  @Field({ nullable: true })
  @IsOptional()
  @IsDateString()
  from?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsDateString()
  to?: string;
}