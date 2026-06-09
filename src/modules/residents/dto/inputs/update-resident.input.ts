import { InputType, Field } from '@nestjs/graphql';
import {
  IsUUID, IsEnum, IsOptional, IsBoolean,
  IsString, IsDateString, MaxLength,
} from 'class-validator';
import { ResidentType } from '../../enums/resident-type.enum';

@InputType()
export class UpdateResidentInput {

  @Field(() => String, { description: 'ID del registro de residente a actualizar' })
  @IsUUID()
  id: string;

  @Field(() => ResidentType, { nullable: true })
  @IsOptional()
  @IsEnum(ResidentType)
  type?: ResidentType;

  @Field(() => Boolean, { nullable: true })
  @IsOptional()
  @IsBoolean()
  isMainResident?: boolean;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  emergencyContactName?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  emergencyContactLastName?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  emergencyContactPhone?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @Field(() => String, { description: 'ID de la unidad a la que se asignará' })
  @IsUUID()
  unitId: string;

  @Field(() => String, { nullable: true, description: 'Nombre del usuario residente' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @Field(() => String, { nullable: true, description: 'Apellido del usuario residente' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  lastName?: string;

  @Field(() => String, { nullable: true, description: 'Teléfono del usuario residente' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phoneNumber?: string;

}
