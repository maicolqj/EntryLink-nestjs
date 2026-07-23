import { InputType, Field } from '@nestjs/graphql';
import { IsBoolean, IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { LegalAudience } from '../../enums/legal-audience.enum';

@InputType()
export class UpdateLegalDocumentInput {
  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  title?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @Field(() => Boolean, { nullable: true })
  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;

  @Field(() => String, {
    nullable: true,
    description: 'Nuevo .docx en base64. Si se envía, reemplaza el contenido HTML e incrementa la versión.',
  })
  @IsOptional()
  @IsString()
  docxBase64?: string;

  @Field(() => LegalAudience, { nullable: true })
  @IsOptional()
  @IsEnum(LegalAudience)
  audience?: LegalAudience;

  @Field(() => Boolean, { nullable: true })
  @IsOptional()
  @IsBoolean()
  isDownloadable?: boolean;

  @Field(() => String, { nullable: true, description: 'Nuevo PDF descargable en base64. Reemplaza el anterior.' })
  @IsOptional()
  @IsString()
  pdfBase64?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  pdfFileName?: string;
}
