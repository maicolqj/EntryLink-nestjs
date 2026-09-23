import { InputType, Field, Int } from '@nestjs/graphql';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { MarketplaceModerationMode } from '../../enums/marketplace-moderation-mode.enum';

@InputType()
export class UpdateMarketplaceSettingsInput {
  @Field(() => String)
  @IsUUID()
  complexId: string;

  @Field(() => MarketplaceModerationMode, { nullable: true })
  @IsOptional()
  @IsEnum(MarketplaceModerationMode)
  moderationMode?: MarketplaceModerationMode;

  /** Entre una semana y un año. Fuera de ahí la vigencia deja de serlo. */
  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(7)
  @Max(365)
  listingDurationDays?: number;

  /** Igual que la de clasificados: entre una semana y un año. */
  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(7)
  @Max(365)
  serviceListingDurationDays?: number;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  maxActiveListingsPerUnit?: number;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10)
  maxImagesPerListing?: number;

  /** Cero apaga la pausa automática: todo espera a la administración. */
  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(20)
  autoPauseAfterReports?: number;

  @Field(() => Boolean, { nullable: true })
  @IsOptional()
  @IsBoolean()
  allowPhoneContact?: boolean;

  @Field(() => Boolean, { nullable: true })
  @IsOptional()
  @IsBoolean()
  allowWantedListings?: boolean;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  termsText?: string;
}
