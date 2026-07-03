import { InputType, Field, GraphQLISODateTime } from '@nestjs/graphql';
import {
  IsUUID, IsEnum, IsOptional, IsBoolean,
  IsString, IsDateString, MaxLength, IsEmail, IsPhoneNumber,
} from 'class-validator';
import { ResidentType } from '../../enums/resident-type.enum';
import { UserIdentityType } from '../../../users/enums/user.enums';

@InputType()
export class CreateResidentInput {

  // ── Datos personales del nuevo residente ─────────────────────────────

  @Field(() => String, { description: 'Nombre del residente' })
  @IsString()
  @MaxLength(100)
  name: string;

  @Field(() => String, { description: 'Apellido del residente' })
  @IsString()
  @MaxLength(100)
  lastName: string;

  @Field(() => String, { description: 'Correo electrónico del residente' })
  @IsEmail()
  email: string;

  @Field(() => String, { description: 'Número de teléfono del residente' })
  @IsString()
  @MaxLength(13)
  phoneNumber: string;

  @Field(() => String, { description: 'Número de documento de identidad del residente' })
  @IsString()
  @MaxLength(20)
  identityNumber: string;

  @Field(() => UserIdentityType, {
    defaultValue: UserIdentityType.CC,
    description: 'Tipo de documento de identidad del residente',
  })
  @IsOptional()
  @IsEnum(UserIdentityType)
  identityType?: UserIdentityType;

  // ── Asignación ────────────────────────────────────────────────────────

  @Field(() => String, { description: 'ID de la unidad a la que se asignará' })
  @IsUUID()
  unitId: string;

  @Field(() => String, { description: 'ID del complejo residencial' })
  @IsUUID()
  complexId: string;

  @Field(() => ResidentType, { defaultValue: ResidentType.OWNER })
  @IsOptional()
  @IsEnum(ResidentType)
  type?: ResidentType;

  @Field(() => Boolean, { defaultValue: false })
  @IsOptional()
  @IsBoolean()
  isMainResident?: boolean;

  // ── Contacto de emergencia ────────────────────────────────────────────

  @Field(() => String, { description: 'Nombre del contacto de emergencia' })
  @IsString()
  @MaxLength(100)
  emergencyContactName: string;

  @Field(() => String, { description: 'Apellido del contacto de emergencia' })
  @IsString()
  @MaxLength(100)
  emergencyContactLastName: string;

  @Field(() => String, { description: 'Teléfono del contacto de emergencia' })
  @IsString()
  @MaxLength(20)
  emergencyContactPhone: string;

  // ── Opcionales ────────────────────────────────────────────────────────

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
}
