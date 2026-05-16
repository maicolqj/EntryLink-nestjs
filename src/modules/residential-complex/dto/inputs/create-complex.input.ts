import { InputType, Field, Int, Float } from '@nestjs/graphql';
import {
  IsString, IsEnum, IsOptional, IsEmail, IsUUID,
  MaxLength, MinLength, IsPhoneNumber, Matches,
  ValidateNested, IsNumber, Min, Max,
} from 'class-validator';
import GraphQLJSON from 'graphql-type-json';
import { ComplexType }   from '../../enums/complex-type.enum';
import { ComplexPlan }   from '../../enums/complex-plan.enum';
import { CountryCode } from '../../../users/dto/inputs/create-admin-user.input';
import { Type } from 'class-transformer';

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


  @Field(() => CountryCode, { nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => CountryCode)
  countryCode?: CountryCode;

  @Field(() => String, { nullable: true })
  @IsOptional()
  // @IsPhoneNumber()
  phoneNumber?: string;

  @Field(() => String, { nullable: true })
  @IsOptional() 
  @IsEmail()
  @MaxLength(100)
  email?: string;
  
  @Field(() => String, { nullable: true, description: 'Contraseña de acceso al portal del complejo' })
  @IsOptional()
  @IsString()
  @MinLength(8, { message: 'La contraseña debe tener mínimo 8 caracteres' })
  @MaxLength(128)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&.*_\-])/, {
    message: 'La contraseña debe contener mayúsculas, minúsculas, números y un carácter especial',
  })
  password?: string;

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

  @Field(() => String, { nullable: true, description: 'ID (UUID) del representante legal' })
  @IsOptional()
  @IsUUID()
  legalRepresentativeId?: string;

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

  @Field(() => Float, { nullable: true, description: 'Latitud GPS del complejo para validación de presencia de supervisores' })
  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number;

  @Field(() => Float, { nullable: true, description: 'Longitud GPS del complejo para validación de presencia de supervisores' })
  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number;

  @Field(() => Int, { nullable: true, description: 'Radio en metros para validar presencia GPS (por defecto 200 m)' })
  @IsOptional()
  @IsNumber()
  @Min(50)
  @Max(5000)
  gpsRadius?: number;
}
