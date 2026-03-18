import { InputType, Field } from '@nestjs/graphql';
import { IsUUID, IsOptional, IsString, IsDateString, MaxLength } from 'class-validator';

/**
 * Input para registrar la salida (mudanza) de un residente.
 */
@InputType()
export class MoveOutResidentInput {

  @Field(() => String, { description: 'ID del registro de residente' })
  @IsUUID()
  residentId: string;

  @Field(() => String, { description: 'Fecha de mudanza (YYYY-MM-DD)', nullable: true })
  @IsOptional()
  @IsDateString()
  moveOutDate?: string;

  @Field(() => String, { description: 'Razón de la salida', nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  moveOutReason?: string;
}
