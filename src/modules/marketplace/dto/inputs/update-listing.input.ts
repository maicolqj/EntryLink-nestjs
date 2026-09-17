import { InputType, Field, Float } from '@nestjs/graphql';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import { MarketplaceListingType } from '../../enums/marketplace-listing-type.enum';
import { MarketplacePriceType } from '../../enums/marketplace-price-type.enum';
import { MarketplaceItemCondition } from '../../enums/marketplace-item-condition.enum';
import { MarketplaceContactPreference } from '../../enums/marketplace-contact-preference.enum';

/**
 * Corrección de un aviso propio. Las fotos NO se tocan aquí —van por REST— pero
 * sí se pueden reordenar o quitar mandando la lista que debe quedar.
 */
@InputType()
export class UpdateListingInput {
  @Field(() => String)
  @IsUUID()
  listingId: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MinLength(5)
  @MaxLength(120)
  title?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MinLength(10)
  @MaxLength(4000)
  description?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @Field(() => MarketplaceListingType, { nullable: true })
  @IsOptional()
  @IsEnum(MarketplaceListingType)
  type?: MarketplaceListingType;

  @Field(() => MarketplaceItemCondition, { nullable: true })
  @IsOptional()
  @IsEnum(MarketplaceItemCondition)
  condition?: MarketplaceItemCondition;

  @Field(() => Float, { nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0)
  priceAmount?: number;

  @Field(() => MarketplacePriceType, { nullable: true })
  @IsOptional()
  @IsEnum(MarketplacePriceType)
  priceType?: MarketplacePriceType;

  @Field(() => MarketplaceContactPreference, { nullable: true })
  @IsOptional()
  @IsEnum(MarketplaceContactPreference)
  contactPreference?: MarketplaceContactPreference;

  @Field(() => Boolean, { nullable: true })
  @IsOptional()
  @IsBoolean()
  showPhone?: boolean;

  /**
   * Lista final de fotos. Solo admite quitar o reordenar lo que ya está
   * subido: aceptar URLs nuevas aquí sería dejar publicar cualquier enlace
   * externo en la vitrina del conjunto.
   */
  @Field(() => [String], { nullable: true })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  imageUrls?: string[];
}
