import { InputType, Field } from '@nestjs/graphql';
import {
  IsUUID, IsEnum, IsOptional, IsBoolean,
  IsString, IsDateString, MaxLength, IsPhoneNumber,
} from 'class-validator';
import { ResidentType } from '../../enums/resident-type.enum';

@InputType()
export class CreateResidentInput {

  @Field(() => String, { description: 'ID del usuario que será asignado como residente' })
  @IsUUID()
  userId: string;

  @Field(() => String, { description: 'ID de la unidad a la que se asignará' })
  @IsUUID()
  unitId: string;

  @Field(() => String, { description: 'ID del complejo residencial' })
  @IsUUID()
  complexId: string;

  @Field(() => ResidentType, { description: 'Tipo de residente', defaultValue: ResidentType.OWNER })
  @IsOptional()
  @IsEnum(ResidentType)
  type?: ResidentType;

  @Field(() => Boolean, { description: 'Es el residente principal de la unidad', defaultValue: false })
  @IsOptional()
  @IsBoolean()
  isMainResident?: boolean;

  @Field(() => String, { description: 'Fecha de inicio de residencia (YYYY-MM-DD)' })
  @IsDateString()
  startDate: string;

  @Field(() => String, { description: 'Fecha de fin de contrato — para arrendatarios (YYYY-MM-DD)', nullable: true })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @Field(() => String, { description: 'Nombre del contacto de emergencia', nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  emergencyContactName?: string;

  @Field(() => String, { description: 'Teléfono del contacto de emergencia', nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  emergencyContactPhone?: string;

  @Field(() => String, { description: 'Notas internas del administrador', nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
