import { InputType, Field, Int, PartialType, OmitType } from '@nestjs/graphql';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Max,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

import {
  ComplexContactCategory,
  ComplexDocumentAudience,
  ComplexDocumentCategory,
  ComplexScheduleCategory,
} from '../enums/complex-info.enums';

@InputType()
export class CreateComplexDocumentInput {
  @Field(() => String)
  @IsUUID()
  complexId: string;

  @Field(() => ComplexDocumentCategory)
  @IsEnum(ComplexDocumentCategory)
  category: ComplexDocumentCategory;

  @Field(() => String)
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  title: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @Field(() => String, {
    nullable: true,
    description:
      'Word (.docx) en base64: su texto se convierte a HTML para leerlo en la app',
  })
  @IsOptional()
  @IsString()
  docxBase64?: string;

  @Field(() => ComplexDocumentAudience, {
    nullable: true,
    description: 'ALL_RESIDENTS por defecto',
  })
  @IsOptional()
  @IsEnum(ComplexDocumentAudience)
  audience?: ComplexDocumentAudience;

  @Field(() => Boolean, { nullable: true })
  @IsOptional()
  @IsBoolean()
  isPinned?: boolean;

  @Field(() => Boolean, { nullable: true })
  @IsOptional()
  @IsBoolean()
  requiresAcknowledgement?: boolean;

  @Field(() => String, { nullable: true, description: 'YYYY-MM-DD' })
  @IsOptional()
  @IsDateString()
  effectiveDate?: string;
}

@InputType()
export class UpdateComplexDocumentInput extends PartialType(
  OmitType(CreateComplexDocumentInput, ['complexId', 'effectiveDate'] as const),
) {
  @Field(() => String, {
    nullable: true,
    description: 'YYYY-MM-DD. Cadena vacía = quitar la fecha',
  })
  @IsOptional()
  @IsString()
  effectiveDate?: string;

  @Field(() => Boolean, {
    nullable: true,
    description: 'Quita el texto del documento (deja solo el PDF)',
  })
  @IsOptional()
  @IsBoolean()
  removeContent?: boolean;

  @Field(() => Boolean, {
    nullable: true,
    description: 'Quita el PDF adjunto (deja solo el texto)',
  })
  @IsOptional()
  @IsBoolean()
  removeFile?: boolean;

  @Field(() => Boolean, { nullable: true })
  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;

  @Field(() => Boolean, {
    nullable: true,
    description:
      'Avisar a los residentes al publicar o al cambiar el contenido. true por defecto',
  })
  @IsOptional()
  @IsBoolean()
  notifyResidents?: boolean;
}

@InputType()
export class UpdateComplexInfoSettingsInput {
  @Field(() => Boolean, { nullable: true })
  @IsOptional()
  @IsBoolean()
  showCall?: boolean;

  @Field(() => Boolean, { nullable: true })
  @IsOptional()
  @IsBoolean()
  showEmail?: boolean;

  @Field(() => Boolean, { nullable: true })
  @IsOptional()
  @IsBoolean()
  showDirections?: boolean;

  @Field(() => Boolean, { nullable: true })
  @IsOptional()
  @IsBoolean()
  showWebsite?: boolean;
}

const PHONE_PATTERN = /^[+\d][\d\s()-]{5,29}$/;

@InputType()
export class CreateComplexContactInput {
  @Field(() => String)
  @IsUUID()
  complexId: string;

  @Field(() => ComplexContactCategory)
  @IsEnum(ComplexContactCategory)
  category: ComplexContactCategory;

  @Field(() => String)
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  name: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  role?: string;

  @Field(() => String, { nullable: true })
  // Cadena vacía = quitarlo al editar.
  @ValidateIf((o: CreateComplexContactInput) => !!o.phone)
  @IsString()
  @Matches(PHONE_PATTERN, { message: 'El teléfono no es válido' })
  phone?: string;

  @Field(() => String, { nullable: true })
  @ValidateIf((o: CreateComplexContactInput) => !!o.email)
  @IsEmail({}, { message: 'El correo no es válido' })
  @MaxLength(150)
  email?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  schedule?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @Field(() => Boolean, { nullable: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

@InputType()
export class UpdateComplexContactInput extends PartialType(
  OmitType(CreateComplexContactInput, ['complexId'] as const),
) {}

/** HH:mm en 24 h (00:00 – 23:59). */
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

@InputType()
export class ComplexScheduleSlotInput {
  @Field(() => Int, { description: '0=domingo, 1=lunes … 6=sábado' })
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek: number;

  @Field({ description: 'Hora de apertura HH:mm' })
  @Matches(HHMM, { message: 'La hora de apertura debe tener formato HH:mm' })
  openTime: string;

  @Field({ description: 'Hora de cierre HH:mm' })
  @Matches(HHMM, { message: 'La hora de cierre debe tener formato HH:mm' })
  closeTime: string;
}

@InputType()
export class CreateComplexScheduleInput {
  @Field(() => String)
  @IsUUID()
  complexId: string;

  @Field(() => ComplexScheduleCategory)
  @IsEnum(ComplexScheduleCategory)
  category: ComplexScheduleCategory;

  @Field(() => String)
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name: string;

  @Field(() => [ComplexScheduleSlotInput], {
    description: 'Reemplaza todas las franjas. Un día sin franjas = cerrado',
  })
  @IsArray()
  @ArrayMaxSize(28)
  @ValidateNested({ each: true })
  @Type(() => ComplexScheduleSlotInput)
  slots: ComplexScheduleSlotInput[];

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  @Field(() => Boolean, { nullable: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

@InputType()
export class UpdateComplexScheduleInput extends PartialType(
  OmitType(CreateComplexScheduleInput, ['complexId'] as const),
) {}
