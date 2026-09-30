import { InputType, Field, Int, PartialType, OmitType } from '@nestjs/graphql';
import {
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
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

import {
  ComplexContactCategory,
  ComplexDocumentAudience,
  ComplexDocumentCategory,
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
