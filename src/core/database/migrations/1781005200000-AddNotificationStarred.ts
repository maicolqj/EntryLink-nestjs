import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Marca de "importante" sobre la notificación, como la estrella del correo.
 *
 * La bandeja de un administrador recibe decenas de avisos al día y hoy lo único
 * que distingue uno de otro es la prioridad que puso el módulo que lo emitió.
 * Eso ordena por urgencia técnica, no por lo que esta persona tiene pendiente:
 * un paquete "normal" puede ser justo el que está reclamando un residente.
 *
 * Vive en la fila y no en una tabla aparte porque el fan-out ya crea un
 * registro por destinatario (`createBulk`), así que la fila ES de un usuario.
 * La excepción son los broadcasts (`isBroadcast = true`, sin destinatario), que
 * son un registro compartido: ahí la estrella se comportaría como el estado de
 * lectura —que tampoco se aplica— y el servicio la rechaza.
 *
 * Columna en camelCase a propósito: esta tabla nació con el naming por defecto
 * de TypeORM ("isRead", "isBroadcast", "recipientUserId") y mezclar estilos
 * dentro de la misma tabla obliga a recordar cuál es cuál en cada consulta.
 */
export class AddNotificationStarred1781005200000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "notifications"
        ADD COLUMN IF NOT EXISTS "isStarred" boolean NOT NULL DEFAULT false
    `);

    // Índice parcial: lo destacado es una minoría dentro del buzón, y el filtro
    // "Destacadas" siempre viene acotado al destinatario.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_notifications_recipient_starred"
        ON "notifications" ("recipientUserId")
        WHERE "isStarred" = true
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_notifications_recipient_starred"`,
    );
    await queryRunner.query(
      `ALTER TABLE "notifications" DROP COLUMN IF EXISTS "isStarred"`,
    );
  }
}
