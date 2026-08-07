import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Desactiva las suscripciones push que apuntan a un equipo que ya cambió de dueño.
 *
 * Un token FCM identifica una INSTALACIÓN y un endpoint Web Push un NAVEGADOR:
 * ninguno cambia al cambiar de sesión. Hasta ahora, al entrar otra cuenta en el
 * mismo equipo se creaba una fila nueva sin desactivar la anterior, así que
 * quedaban varias cuentas activas contra el mismo destino.
 *
 * Efecto observado en producción el 2026-08-07: una alerta de pánico llegó dos
 * veces al mismo teléfono, con dos confirmaciones de entrega. Y lo serio: las
 * notificaciones de la cuenta anterior se entregaban en un equipo que hoy usa
 * otra persona.
 *
 * `saveMobileToken` / `savePushSubscription` ya no lo permiten, pero ese barrido
 * solo actúa cuando el equipo vuelve a registrarse. Esta migración cierra el
 * hueco de los que no lo hagan: por cada destino con más de una fila activa,
 * conserva la de `updated_at` más reciente —la del dueño actual— y desactiva el
 * resto.
 *
 * Desactiva, no borra: el historial de qué equipos estuvieron registrados es lo
 * que alimenta la medición de entrega por marca.
 */
export class DeactivateCrossAccountPushSubscriptions1781003600000 implements MigrationInterface {

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Un solo UPDATE por columna de destino. `DISTINCT ON` ordenado por
    // updated_at deja arriba la fila viva de cada destino; todo lo demás cae.
    for (const column of ['device_token', 'endpoint']) {
      await queryRunner.query(`
        UPDATE push_subscriptions
        SET is_active = false
        WHERE is_active = true
          AND ${column} IS NOT NULL
          AND id NOT IN (
            SELECT DISTINCT ON (${column}) id
            FROM push_subscriptions
            WHERE is_active = true AND ${column} IS NOT NULL
            ORDER BY ${column}, updated_at DESC
          )
      `);
    }
  }

  public async down(): Promise<void> {
    // Irreversible a propósito: reactivar a ciegas volvería a entregar
    // notificaciones de una cuenta en el equipo de otra, que es justo lo que
    // esta migración corrige. Los equipos vivos se reactivan solos al registrar
    // su token en el siguiente arranque de la app.
  }
}
