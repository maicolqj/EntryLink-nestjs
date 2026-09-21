import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Franja de aseo sugerida por tipo de zona.
 *
 * `AmenityCleaningWindow` dejó el campo en 0 para todas las zonas, así que
 * ninguna aparta tiempo para recogerse. Esto siembra un valor de arranque según
 * lo que ensucia cada tipo: un asador deja grasa y carbón, una cancha se
 * entrega y ya.
 *
 * Es una SUGERENCIA, no una regla. La franja definitiva la decide el
 * administrador en cada reserva, que es donde se sabe si hubo comida, licor y
 * decoración —el disparador real, mucho más que las horas—.
 *
 * NO enciende `cleaning_service_available`. Ese interruptor promete que la
 * administración se encarga del aseo, y sin `cleaning_fee_amount` la app se lo
 * ofrecería al residente como "sin costo": una promesa que la copropiedad no
 * ha hecho. Encenderlo con su precio es decisión de cada administración, desde
 * la ficha de la zona.
 *
 * Solo toca zonas INTACTAS (franja en 0 y servicio apagado): una que el
 * administrador ya configuró manda sobre cualquier sugerencia.
 */

/** Minutos de aseo sugeridos por tipo. Lo que no aparece se queda en 0. */
const SUGGESTED_MINUTES: Record<string, number> = {
  // Evento con comida y decoración: es la zona que más trabajo deja.
  SALON_COMUNAL: 180,
  TEATRINO: 120,
  // Se usa para eventos con la misma frecuencia que el salón.
  TERRAZA: 120,
  // Grasa y carbón.
  ZONA_BBQ: 60,
  // Recambio de agua y desinfección entre turnos.
  SAUNA: 90,
  // PISCINA va por mantenimiento programado, no por reserva.
  // GIMNASIO, CANCHA, COWORKING y PARQUE_INFANTIL se entregan y ya.
};

export class AmenityCleaningDefaults1781005800000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const [type, minutes] of Object.entries(SUGGESTED_MINUTES)) {
      await queryRunner.query(
        `UPDATE "amenities"
            SET "default_cleaning_minutes" = $1
          WHERE "type" = $2
            AND "default_cleaning_minutes" = 0
            AND "cleaning_service_available" = false
            AND "deleted_at" IS NULL`,
        [minutes, type],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Solo se devuelven a 0 las que quedaron con EXACTAMENTE el valor sembrado
    // y sin servicio de aseo: si el administrador la ajustó después, su número
    // no es de esta migración y no se toca.
    for (const [type, minutes] of Object.entries(SUGGESTED_MINUTES)) {
      await queryRunner.query(
        `UPDATE "amenities"
            SET "default_cleaning_minutes" = 0
          WHERE "type" = $1
            AND "default_cleaning_minutes" = $2
            AND "cleaning_service_available" = false`,
        [type, minutes],
      );
    }
  }
}
