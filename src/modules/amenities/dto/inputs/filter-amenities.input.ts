import { InputType, Field } from '@nestjs/graphql';
import { IsOptional, IsEnum, IsString, MaxLength } from 'class-validator';

import { AmenityType }   from '../../enums/amenity-type.enum';
import { AmenityStatus } from '../../enums/amenity-status.enum';

@InputType()
export class FilterAmenitiesInput {

  @Field(() => AmenityStatus, { nullable: true })
  @IsOptional()
  @IsEnum(AmenityStatus)
  status?: AmenityStatus;

  @Field(() => AmenityType, { nullable: true })
  @IsOptional()
  @IsEnum(AmenityType)
  type?: AmenityType;

  @Field(() => String, { nullable: true, description: 'Búsqueda por nombre' })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  search?: string;
}
