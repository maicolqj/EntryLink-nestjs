import { ObjectType, Field, ID, Int, Float } from '@nestjs/graphql';

import { MaintenanceCategory } from '../../enums/maintenance-category.enum';
import { MaintenancePriority } from '../../enums/maintenance-priority.enum';
import { MaintenanceTicketStatus } from '../../enums/maintenance-ticket-status.enum';
import { MaintenanceLocationType } from '../../enums/maintenance-location-type.enum';

/**
 * Lo mínimo para pintar un punto en el mapa.
 *
 * Es un tipo aparte y no el ticket completo porque el mapa pide todos los
 * puntos de una: mandar la descripción, las fotos y las relaciones de cada uno
 * para dibujar un círculo de ocho píxeles es lo que hace que un mapa tarde tres
 * segundos en abrir. El detalle se pide al tocar el pin.
 */
@ObjectType({ description: 'Punto del mapa de incidencias' })
export class MaintenanceMapPinResponse {
  @Field(() => ID)
  id: string;

  @Field(() => String)
  code: string;

  @Field(() => String)
  title: string;

  @Field(() => MaintenanceCategory)
  category: MaintenanceCategory;

  @Field(() => MaintenancePriority)
  priority: MaintenancePriority;

  @Field(() => MaintenanceTicketStatus)
  status: MaintenanceTicketStatus;

  @Field(() => MaintenanceLocationType)
  locationType: MaintenanceLocationType;

  @Field(() => Float)
  lat: number;

  @Field(() => Float)
  lng: number;

  @Field(() => Int, { nullable: true })
  gpsAccuracyMeters?: number | null;

  /**
   * Falso cuando el punto viene de un GPS con más error del que el complejo
   * tolera. El mapa lo pinta translúcido o lo manda a la lista de "sin
   * ubicación confiable"; lo que no puede es dibujarlo como si fuera exacto.
   */
  @Field(() => Boolean)
  isPrecise: boolean;

  @Field(() => Boolean)
  isOverdue: boolean;

  @Field(() => Int)
  endorsementCount: number;

  @Field(() => Date)
  createdAt: Date;
}
