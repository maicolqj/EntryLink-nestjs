import { InputType, Field, Int } from '@nestjs/graphql';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import { MarketplaceCategoryKind } from '../../enums/marketplace-category-kind.enum';

@InputType()
export class UpsertMarketplaceCategoryInput {
  /** Sin id se crea; con id se edita. */
  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @Field(() => String)
  @IsUUID()
  complexId: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name?: string;

  @Field(() => MarketplaceCategoryKind, { nullable: true })
  @IsOptional()
  @IsEnum(MarketplaceCategoryKind)
  kind?: MarketplaceCategoryKind;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  icon?: string;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @Field(() => Boolean, { nullable: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
