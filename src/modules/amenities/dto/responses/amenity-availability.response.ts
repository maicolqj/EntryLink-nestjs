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

  /**
   * Fin de la OCUPACIÓN, con la franja de aseo incluida. Es hasta cuándo la
   * zona no se puede volver a reservar.
   */
  @Field()
  endAt: Date;

  /**
   * Desde qué instante el tramo es aseo y no uso, o null si la reserva no
   * arrastra franja. El cliente lo pinta distinto: al vecino le sirve saber
   * que la zona está tomada, pero "reservada hasta las 10" y "la están
   * aseando hasta las 10" no son lo mismo.
   */
  @Field(() => Date, { nullable: true })
  cleaningFromAt?: Date | null;

  /** Cuántas reservas activas coinciden exactamente en este intervalo. */
  @Field(() => Int)
  bookingsCount: number;
}

@ObjectType({
  description: 'Disponibilidad de una zona común en un día calendario',
})
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

  /**
   * A qué horas ABRE la zona ese día, no a qué horas se puede empezar una
   * reserva. Un día con `isOpen: false` por FUERA_DE_VENTANA igual reporta sus
   * ventanas: una reserva que empieza dentro del plazo puede continuar hasta el
   * día siguiente, y el cliente necesita esas horas para unir el periodo.
   */
  @Field(() => [AmenityTimeWindow])
  openWindows: AmenityTimeWindow[];

  @Field(() => [AmenitySlot])
  slots: AmenitySlot[];

  @Field(() => [AmenityBusyRange])
  busy: AmenityBusyRange[];
}

@ObjectType({
  description: 'Disponibilidad de una zona común en un rango de días',
})
export class AmenityAvailabilityResponse {
  @Field()
  amenityId: string;

  @Field(() => [AmenityAvailabilityDay])
  days: AmenityAvailabilityDay[];
}
