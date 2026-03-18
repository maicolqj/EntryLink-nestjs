import { IsString, IsUUID, MinLength, MaxLength } from 'class-validator';

/**
 * DTO para crear una nota via REST (POST /api/v1/notes).
 * Las imágenes se reciben como archivos multipart, no como URLs.
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
}
