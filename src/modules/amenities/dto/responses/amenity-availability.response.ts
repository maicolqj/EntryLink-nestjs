import { ObjectType, Field, Int } from '@nestjs/graphql';

/** Ventana continua de apertura dentro de un día, ya descontados los bloqueos. */
@ObjectType({ description: 'Ventana de apertura de la zona común en un día' })
export class AmenityTimeWindow {

  @Field()
  startAt: Date;

  @Field()
  endAt: Date;
}

/**
 * Franja concreta reservable. Solo se emite para zonas con bookingMode = SLOT;
 * en modo RANGE el cliente arma el rango sobre `openWindows` y `busy`.
 */
@ObjectType({ description: 'Franja reservable de una zona común' })
export class AmenitySlot {

  @Field()
  startAt: Date;

  @Field()
  endAt: Date;

  /** Cupos totales de la franja (= amenity.maxSimultaneousBookings). */
  @Field(() => Int)
  capacityTotal: number;

  /** Cupos ya tomados por reservas activas. */
  @Field(() => Int)
  capacityUsed: number;

  /**
   * false cuando no quedan cupos o cuando la franja ya no cumple la
   * anticipación mínima. El cliente no debe recalcular esto.
   */
  @Field()
  isAvailable: boolean;
}

/** Intervalo ya ocupado por una reserva activa. Sin datos del titular. */
@ObjectType({ description: 'Intervalo ocupado por una reserva activa' })
export class AmenityBusyRange {

  @Field()
  startAt: Date;

  @Field()
  endAt: Date;

  /** Cuántas reservas activas coinciden exactamente en este intervalo. */
  @Field(() => Int)
  bookingsCount: number;
}

@ObjectType({ description: 'Disponibilidad de una zona común en un día calendario' })
export class AmenityAvailabilityDay {

  @Field(() => String, { description: 'Fecha en formato YYYY-MM-DD' })
  date: string;

  @Field()
  isOpen: boolean;

  /**
   * Por qué el día no admite reservas: SIN_HORARIO, BLOQUEADA, ZONA_INACTIVA o
   * FUERA_DE_VENTANA (fuera del rango de anticipación permitido).
   */
  @Field(() => String, { nullable: true })
  closedReason?: string | null;

  @Field(() => [AmenityTimeWindow])
  openWindows: AmenityTimeWindow[];

  @Field(() => [AmenitySlot])
  slots: AmenitySlot[];

  @Field(() => [AmenityBusyRange])
  busy: AmenityBusyRange[];
}

@ObjectType({ description: 'Disponibilidad de una zona común en un rango de días' })
export class AmenityAvailabilityResponse {

  @Field()
  amenityId: string;

  @Field(() => [AmenityAvailabilityDay])
  days: AmenityAvailabilityDay[];
}
