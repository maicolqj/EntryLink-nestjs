import { InputType, Field } from '@nestjs/graphql';
import {
  IsString, IsNotEmpty, IsOptional, IsEnum,
  MaxLength, IsInt, Min, Max,
} from 'class-validator';

import { PackageType } from '../../enums/package-type.enum';

@InputType()
export class RegisterPackageInput {

  @Field()
  @IsString()
  @IsNotEmpty()
  unitId: string;

  @Field()
  @IsString()
  @IsNotEmpty()
  complexId: string;

  @Field()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  senderName: string;

  @Field(() => PackageType, { defaultValue: PackageType.PARCEL })
  @IsEnum(PackageType)
  type: PackageType;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  trackingCode?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  photoUrl?: string;

  @Field(() => Number, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(90)
  maxStorageDays?: number;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  recipientName?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
