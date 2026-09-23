import { InputType, Field, Float } from '@nestjs/graphql';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

import { MarketplaceListingType } from '../../enums/marketplace-listing-type.enum';
import { MarketplaceListingStatus } from '../../enums/marketplace-listing-status.enum';
import { MarketplacePriceType } from '../../enums/marketplace-price-type.enum';

@InputType()
export class FilterListingsInput {
  @Field(() => String, {
    nullable: true,
    description: 'Busca en el título y en la descripción',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @Field(() => MarketplaceListingStatus, { nullable: true })
  @IsOptional()
  @IsEnum(MarketplaceListingStatus)
  status?: MarketplaceListingStatus;

  @Field(() => MarketplaceListingType, { nullable: true })
  @IsOptional()
  @IsEnum(MarketplaceListingType)
  type?: MarketplaceListingType;

  /**
   * Tipos que NO se quieren. La vitrina de clasificados excluye `SERVICE`, que
   * tiene su propio directorio; filtrar en el cliente rompería la paginación.
   */
  @Field(() => [MarketplaceListingType], {
    nullable: true,
    description: 'Tipos de publicación que se excluyen del listado',
  })
  @IsOptional()
  @IsArray()
  @IsEnum(MarketplaceListingType, { each: true })
  excludeTypes?: MarketplaceListingType[];

  @Field(() => MarketplacePriceType, { nullable: true })
  @IsOptional()
  @IsEnum(MarketplacePriceType)
  priceType?: MarketplacePriceType;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @Field(() => String, {
    nullable: true,
    description: 'Solo para la administración: avisos de una unidad',
  })
  @IsOptional()
  @IsUUID()
  unitId?: string;

  @Field(() => Float, { nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0)
  minPrice?: number;

  @Field(() => Float, { nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0)
  maxPrice?: number;

  @Field(() => Boolean, {
    nullable: true,
    description: 'Solo mis publicaciones',
  })
  @IsOptional()
  @IsBoolean()
  onlyMine?: boolean;

  @Field(() => Boolean, {
    nullable: true,
    description: 'Solo las que guardé como favoritas',
  })
  @IsOptional()
  @IsBoolean()
  onlyFavorites?: boolean;

  @Field(() => Boolean, {
    nullable: true,
    description: 'Solo las que tienen reportes sin resolver',
  })
  @IsOptional()
  @IsBoolean()
  onlyReported?: boolean;
}
