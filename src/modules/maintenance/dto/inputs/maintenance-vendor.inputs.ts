import { InputType, Field, PartialType, OmitType } from '@nestjs/graphql';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

import { MaintenanceCategory } from '../../enums/maintenance-category.enum';

@InputType()
export class CreateMaintenanceVendorInput {
  @Field(() => String)
  @IsUUID()
  complexId: string;

  @Field(() => String)
  @IsString()
  @MinLength(3)
  @MaxLength(150)
  name: string;

  @Field(() => String, { nullable: true, description: 'NIT o cédula' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  legalId?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  contactName?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsEmail()
  @MaxLength(150)
  email?: string;

  @Field(() => [MaintenanceCategory], { nullable: true })
  @IsOptional()
  @IsEnum(MaintenanceCategory, { each: true })
  specialties?: MaintenanceCategory[];

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string;
}

@InputType()
export class UpdateMaintenanceVendorInput extends PartialType(
  OmitType(CreateMaintenanceVendorInput, ['complexId'] as const),
) {
  @Field(() => String)
  @IsUUID()
  id: string;

  @Field(() => Boolean, { nullable: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
