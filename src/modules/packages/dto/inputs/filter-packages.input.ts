import { InputType, Field } from '@nestjs/graphql';
import { IsOptional, IsEnum, IsString, IsDateString } from 'class-validator';

import { PackageStatus } from '../../enums/package-status.enum';
import { PackageType }   from '../../enums/package-type.enum';

@InputType()
export class FilterPackagesInput {

  @Field(() => PackageStatus, { nullable: true })
  @IsOptional()
  @IsEnum(PackageStatus)
  status?: PackageStatus;

  @Field(() => PackageType, { nullable: true })
  @IsOptional()
  @IsEnum(PackageType)
  type?: PackageType;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  unitId?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  trackingCode?: string;

  /** Filtrar por fecha de recepción (desde) ISO 8601 */
  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsDateString()
  receivedFrom?: string;

  /** Filtrar por fecha de recepción (hasta) ISO 8601 */
  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsDateString()
  receivedUntil?: string;
}
