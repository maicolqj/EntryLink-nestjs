import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Renombra el valor de enum 'VAN' -> 'CAMIONETA' en todos los enums nativos de
 * tipo de vehículo, y actualiza los datos crudos (text[]/jsonb) que guardan el
 * valor literal.
 *
 * Contexto: el backend renombró `VehicleType.VAN` -> `CAMIONETA`, pero la DB corre
 * con `synchronize: false`, así que el enum nativo seguía teniendo 'VAN'. Cualquier
 * registro almacenado como 'VAN' rompía la serialización GraphQL (el enum ya no
 * expone VAN) — p.ej. `rotationStatus` reventaba al serializar vehículos VAN.
 *
 * Idempotente: cada rename se aplica solo si 'VAN' aún existe y 'CAMIONETA' todavía
 * no, en ese enum concreto.
 */
export class RenameVanToCamionetaVehicleType1781002000000 implements MigrationInterface {

  // Un enum nativo por columna (TypeORM no comparte enumName): {tabla}_{columna}_enum
  private readonly enumTypes = [
    'vehicles_type_enum',
    'parking_records_vehicle_type_enum',
    'visitor_vehicles_type_enum',
    'visitor_parking_rates_vehicle_type_enum',
  ];

  private renameValueSql(enumName: string, from: string, to: string): string {
    return `
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM pg_enum e
          JOIN pg_type t ON t.oid = e.enumtypid
          WHERE t.typname = '${enumName}' AND e.enumlabel = '${from}'
        ) AND NOT EXISTS (
          SELECT 1 FROM pg_enum e
          JOIN pg_type t ON t.oid = e.enumtypid
          WHERE t.typname = '${enumName}' AND e.enumlabel = '${to}'
        ) THEN
          ALTER TYPE "${enumName}" RENAME VALUE '${from}' TO '${to}';
        END IF;
      END$$;
    `;
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Renombrar el valor en cada enum nativo (in-place; convierte filas existentes).
    for (const enumName of this.enumTypes) {
      await queryRunner.query(this.renameValueSql(enumName, 'VAN', 'CAMIONETA'));
    }

    // 2. recurring_charges.vehicleTypes (varchar[]) — reemplazar elemento 'VAN'.
    await queryRunner.query(`
      UPDATE "recurring_charges"
      SET "vehicleTypes" = array_replace("vehicleTypes", 'VAN', 'CAMIONETA')
      WHERE 'VAN' = ANY("vehicleTypes")
    `);

    // 3. parking_rotation_configs jsonb — renombrar la clave 'VAN' -> 'CAMIONETA'
    //    en slots_by_type y grand_cycle_by_type.
    for (const column of ['slots_by_type', 'grand_cycle_by_type']) {
      await queryRunner.query(`
        UPDATE "parking_rotation_configs"
        SET "${column}" = (("${column}" - 'VAN') || jsonb_build_object('CAMIONETA', "${column}" -> 'VAN'))
        WHERE "${column}" ? 'VAN'
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const enumName of this.enumTypes) {
      await queryRunner.query(this.renameValueSql(enumName, 'CAMIONETA', 'VAN'));
    }

    await queryRunner.query(`
      UPDATE "recurring_charges"
      SET "vehicleTypes" = array_replace("vehicleTypes", 'CAMIONETA', 'VAN')
      WHERE 'CAMIONETA' = ANY("vehicleTypes")
    `);

    for (const column of ['slots_by_type', 'grand_cycle_by_type']) {
      await queryRunner.query(`
        UPDATE "parking_rotation_configs"
        SET "${column}" = (("${column}" - 'CAMIONETA') || jsonb_build_object('VAN', "${column}" -> 'CAMIONETA'))
        WHERE "${column}" ? 'CAMIONETA'
      `);
    }
  }
}
