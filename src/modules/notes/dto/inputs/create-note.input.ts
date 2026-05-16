import { IsString, IsUUID, MinLength, MaxLength, IsOptional, IsNumber, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * DTO para crear una nota via REST (POST /api/v1/notes).
 * Las imágenes se reciben como archivos multipart, no como URLs.
 *
 * Para SUPERVISOR_ROL: lat y lng son requeridos si el complejo tiene GPS configurado.
 */
export class CreateNoteDto {

  @IsUUID()
  complexId: string;

  @IsString()
  @MinLength(3)
  @MaxLength(255)
  title: string;

  @IsString()
  @MinLength(10)
  content: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng?: number;
}
