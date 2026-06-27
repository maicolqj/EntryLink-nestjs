import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Sincroniza los labels del enum nativo "notifications_type_enum" con el enum
 * TypeScript NotificationType.
 *
 * Causa: la columna notifications.type es un enum nativo de Postgres y el
 * proyecto corre con `synchronize: false`. Varios tipos de notificación
 * (finanzas: WALLET_APPLIED, WALLET_CREDIT, MORA_APPLIED, DIRECT_CHARGE,
 * CHARGE_WAIVED, etc.) se agregaron al enum TS sin migración que los añadiera
 * al tipo Postgres → cualquier INSERT con esos valores fallaba con
 * "invalid input value for enum notifications_type_enum", y como notify() es
 * fire-and-forget el error se tragaba en silencio (sin fila, sin socket, sin push).
 *
 * Idempotente: `ADD VALUE IF NOT EXISTS` (PG 12+) — agregar solo NO usa el valor
 * en la misma transacción, así que es seguro dentro del runner transaccional.
 * Se listan TODOS los labels actuales para cubrir cualquier drift, no solo los de finanzas.
 */
export class AddMissingNotificationTypeEnumValues1781001400000 implements MigrationInterface {

  private readonly values = [
    // Paquetes
    'PACKAGE_RECEIVED', 'PACKAGE_READY', 'PACKAGE_DELIVERED', 'PACKAGE_RETURNED', 'PACKAGE_LOST',
    // Visitas
    'VISITOR_WALK_IN', 'VISIT_APPROVED', 'VISIT_DENIED', 'VISIT_REMINDER', 'VISITOR_ARRIVED', 'VISITOR_BLACKLISTED',
    // Residentes
    'RESIDENT_APPROVED', 'RESIDENT_REJECTED', 'RESIDENT_PENDING',
    // Parqueadero
    'PARKING_ASSIGNED',
    // Vehículos
    'VEHICLE_REGISTERED', 'VEHICLE_APPROVED', 'VEHICLE_REJECTED', 'VEHICLE_SUSPENDED',
    'VEHICLE_REACTIVATED', 'VEHICLE_REMOVED', 'VEHICLE_PENDING',
    // Finanzas
    'PAYMENT_DUE', 'PAYMENT_OVERDUE', 'PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED', 'PAYMENT_REVERSED',
    'CHARGE_ADDED', 'DIRECT_CHARGE', 'CHARGE_WAIVED', 'MORA_APPLIED', 'WALLET_CREDIT', 'WALLET_APPLIED',
    // Seguridad
    'PANIC_ALERT',
    // Sistema
    'SYSTEM_ANNOUNCEMENT', 'COMPLEX_ALERT', 'AMENITY_REMINDER',
    // Accesos
    'ACCESS_REQUEST_APPROVED', 'ACCESS_REQUEST_REJECTED', 'ACCESS_REVOKED_INACTIVITY',
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Solo si el tipo enum existe (lo crea TypeORM al materializar la tabla).
    const [{ exists }] = await queryRunner.query(
      `SELECT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'notifications_type_enum') AS exists`,
    );
    if (!exists) return;

    for (const value of this.values) {
      await queryRunner.query(
        `ALTER TYPE "notifications_type_enum" ADD VALUE IF NOT EXISTS '${value}'`,
      );
    }
  }

  public async down(): Promise<void> {
    // Postgres no soporta DROP VALUE en un enum; revertir requeriría recrear el
    // tipo. Se deja no-op intencionalmente — agregar labels es no destructivo.
  }
}
