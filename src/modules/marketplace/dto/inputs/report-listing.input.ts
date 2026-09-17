import { InputType, Field } from '@nestjs/graphql';
import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

import { MarketplaceReportReason } from '../../enums/marketplace-report-reason.enum';

@InputType()
export class ReportListingInput {
  @Field(() => String)
  @IsUUID()
  listingId: string;

  @Field(() => MarketplaceReportReason)
  @IsEnum(MarketplaceReportReason)
  reason: MarketplaceReportReason;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}
