import {
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Cierre técnico del ticket vía REST (POST /api/v1/maintenance/tickets/:id/resolve).
 *
 * La foto de la reparación terminada es obligatoria y por eso esto no es una
 * mutation. Sin foto, "resuelto" es la palabra de quien tenía que arreglarlo:
 * la mitad de las reaperturas nacen de un ticket cerrado sin que nadie fuera al
 * sitio.
 */
export class ResolveMaintenanceTicketDto {
  @IsUUID()
  ticketId: string;

  @IsString()
  @MinLength(5)
  @MaxLength(2000)
  resolutionNotes: string;

  /**
   * Lo que costó. Queda como dato del ticket; el gasto lo registra
   * contabilidad por su lado.
   */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  actualCost?: number;
}
