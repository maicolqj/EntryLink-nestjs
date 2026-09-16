import {
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';

import { MaintenanceCategory } from '../../enums/maintenance-category.enum';
import { MaintenancePriority } from '../../enums/maintenance-priority.enum';
import { MaintenanceLocationType } from '../../enums/maintenance-location-type.enum';
import { MaintenanceVisibility } from '../../enums/maintenance-visibility.enum';

/**
 * DTO para radicar un ticket vía REST (POST /api/v1/maintenance/tickets).
 *
 * Va por REST y no por GraphQL porque las fotos y el video viajan en la misma
 * petición. Pedirle al residente que suba la evidencia en un segundo paso
 * significa, en la práctica, tickets sin evidencia: el que reporta está de pie
 * frente a la gotera, no sentado frente a un formulario.
 *
 * En multipart todo llega como texto, de ahí los `@Type(() => Number)`: sin
 * ellos `lat` entra como cadena y la validación de rango pasa de largo.
 */
export class CreateMaintenanceTicketDto {
  @IsUUID()
  complexId: string;

  @IsString()
  @MinLength(5)
  @MaxLength(160)
  title: string;

  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  description: string;

  @IsEnum(MaintenanceCategory)
  category: MaintenanceCategory;

  /**
   * Sugerida por quien reporta. La definitiva la pone la administración al
   * revisar: si el residente decidiera, todo entraría en CRITICAL y el tablero
   * dejaría de ordenar nada.
   */
  @IsOptional()
  @IsEnum(MaintenancePriority)
  priority?: MaintenancePriority;

  @IsOptional()
  @IsEnum(MaintenanceVisibility)
  visibility?: MaintenanceVisibility;

  /** Si no llega, la hora del servidor. Nunca puede ser futura. */
  @IsOptional()
  @IsDateString()
  occurredAt?: string;

  // ─── Ubicación ────────────────────────────────────────────────────────────

  @IsEnum(MaintenanceLocationType)
  locationType: MaintenanceLocationType;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  locationText?: string;

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

  /**
   * Error que declara el dispositivo, en metros. La app debe mandarlo tal como
   * lo entrega el navegador o el SDK nativo: es lo único que distingue un punto
   * confiable de uno de sótano.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100000)
  gpsAccuracyMeters?: number;

  @IsOptional()
  @IsUUID()
  buildingId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(-10)
  @Max(200)
  floor?: number;

  @IsOptional()
  @IsUUID()
  amenityId?: string;

  /** Código impreso en el sticker QR/NFC, no el uuid del tag. */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  locationTagCode?: string;

  /**
   * Adherirse a un ticket abierto en vez de crear otro. La app lo manda cuando
   * el usuario acepta la sugerencia de posible duplicado.
   */
  @IsOptional()
  @IsUUID()
  endorseTicketId?: string;
}
