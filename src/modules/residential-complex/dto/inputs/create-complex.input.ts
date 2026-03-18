import { InputType, Field, Int } from '@nestjs/graphql';
import {
  IsString, IsEnum, IsOptional, IsEmail, IsUrl,
  MaxLength, MinLength, IsInt, Min, Max, IsPhoneNumber,
} from 'class-validator';
import GraphQLJSON from 'graphql-type-json';
import { ComplexType }   from '../../enums/complex-type.enum';
import { ComplexPlan }   from '../../enums/complex-plan.enum';

@InputType()
export class CreateComplexInput {

  @Field(() => String)
  @IsString()
  @MinLength(3)
  @MaxLength(150)
  name: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @Field(() => String)
  @IsString()
  @MaxLength(255)
  address: string;

  @Field(() => String)
  @IsString()
  @MaxLength(100)
  city: string;

  @Field(() => String)
  @IsString()
  @MaxLength(100)
  state: string;

  @Field(() => String, { defaultValue: 'Colombia' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  country?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  zipCode?: string;

  @Field(() => ComplexType, { defaultValue: ComplexType.APARTMENT_COMPLEX })
  @IsOptional()
  @IsEnum(ComplexType)
  type?: ComplexType;

  @Field(() => ComplexPlan, { defaultValue: ComplexPlan.FREE })
  @IsOptional()
  @IsEnum(ComplexPlan)
  plan?: ComplexPlan;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsPhoneNumber()
  phone?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsEmail()
  @MaxLength(100)
  email?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  website?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  nit?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  legalRepresentative?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  logoUrl?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  coverUrl?: string;

  @Field(() => GraphQLJSON, { nullable: true })
  @IsOptional()
  settings?: Record<string, any>;
}
