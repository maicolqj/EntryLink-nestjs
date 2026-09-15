import { registerEnumType } from '@nestjs/graphql';

/**
 * Unidad en la que el administrador configura las duraciones de la zona.
 *
 * Internamente todo se guarda en minutos —es la unidad con la que el motor de
 * disponibilidad parte las franjas— pero el negocio piensa distinto según la
 * zona: el asador se presta por horas y el salón comunal por jornadas enteras.
 *
 * La unidad no es cosmética: una zona en DAYS reserva días calendario completos
 * y su reserva puede abarcar varios días, mientras que una en HOURS se resuelve
 * dentro del horario de un mismo día.
 */
export enum AmenityDurationUnit {
  HOURS = 'HOURS',
  DAYS = 'DAYS',
}

registerEnumType(AmenityDurationUnit, {
  name: 'AmenityDurationUnit',
  description: 'Unidad en que se expresan las duraciones de la zona común',
});

export const MINUTES_PER_HOUR = 60;
export const MINUTES_PER_DAY = 24 * 60;

/** Límites del negocio por unidad, ya convertidos a minutos. */
export const DURATION_BOUNDS_MINUTES = {
  [AmenityDurationUnit.HOURS]: {
    min: 1 * MINUTES_PER_HOUR,
    max: 24 * MINUTES_PER_HOUR,
  },
  [AmenityDurationUnit.DAYS]: {
    min: 1 * MINUTES_PER_DAY,
    max: 30 * MINUTES_PER_DAY,
  },
} as const;
