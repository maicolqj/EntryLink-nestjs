import {
  IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Max, MaxLength, Min,
} from 'class-validator';
import { Type } from 'class-transformer';

import { PackageType } from '../../enums/package-type.enum';

export class RegisterPackageBodyDto {

  @IsUUID()
  @IsNotEmpty()
  unitId: string;

  @IsUUID()
  @IsNotEmpty()
  complexId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  senderName: string;

  @IsOptional()
  @IsEnum(PackageType)
  type?: PackageType;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  trackingCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  recipientName?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(90)
  maxStorageDays?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
