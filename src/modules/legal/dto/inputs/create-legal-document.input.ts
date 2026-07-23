import { InputType, Field } from '@nestjs/graphql';
import { IsBoolean, IsEnum, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { LegalAudience } from '../../enums/legal-audience.enum';

@InputType()
export class CreateLegalDocumentInput {
  @Field(() => String, { description: 'Identificador de URL (kebab-case)' })
  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'El slug solo puede contener minúsculas, números y guiones',
  })
  @MaxLength(120)
  slug: string;

  @Field(() => String)
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  title: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @Field(() => String, {
    nullable: true,
    description: 'Archivo .docx en base64 (sin prefijo data URI). Se convierte a HTML en el servidor.',
  })
  @IsOptional()
  @IsString()
  docxBase64?: string;

  @Field(() => LegalAudience, { nullable: true, description: 'PUBLIC por defecto' })
  @IsOptional()
  @IsEnum(LegalAudience)
  audience?: LegalAudience;

  @Field(() => Boolean, { nullable: true, description: 'Si ofrece descarga (requiere pdfBase64)' })
  @IsOptional()
  @IsBoolean()
  isDownloadable?: boolean;

  @Field(() => String, { nullable: true, description: 'PDF descargable en base64 (sin prefijo data URI).' })
  @IsOptional()
  @IsString()
  pdfBase64?: string;

  @Field(() => String, { nullable: true, description: 'Nombre del archivo PDF (para la descarga).' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  pdfFileName?: string;
}
