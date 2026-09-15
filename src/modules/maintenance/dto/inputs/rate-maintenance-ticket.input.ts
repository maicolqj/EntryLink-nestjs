import { InputType, Field, Int } from '@nestjs/graphql';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * La califica quien la reportó, y solo sobre un ticket resuelto.
 *
 * Calificar CIERRA el ticket: es la confirmación de que el trabajo quedó
 * hecho. Si quedó mal, el camino no es una estrella —eso solo deja constancia—
 * sino reabrir, que devuelve el ticket al tablero con el mismo número.
 */
@InputType()
export class RateMaintenanceTicketInput {
  @Field(() => String)
  @IsUUID()
  ticketId: string;

  @Field(() => Int, { description: 'De 1 a 5' })
  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}
