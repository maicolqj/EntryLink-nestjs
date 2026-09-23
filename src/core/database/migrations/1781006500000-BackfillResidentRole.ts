import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Deja RESIDENT_ROL como rol BASE de la plataforma: se suma a cualquier otro,
 * nunca lo reemplaza.
 *
 * Repara dos poblaciones distintas que hoy no lo tienen:
 *
 * 1. Quien ya es residente de una unidad pero se quedó sin el rol. Causa: en
 *    `ResidentsService.create` y en el importador de Excel, la rama que vincula
 *    un usuario que YA EXISTÍA solo creaba la fila en `residents` y nunca el
 *    `user_has_roles`. Solo la rama que creaba el usuario desde cero asignaba el
 *    rol.
 *
 * 2. Quien tiene un cargo en la plataforma —SUPER_ADMIN, COMPILANCE_OFFICER,
 *    ACCOUNTANT, SUPERVISOR o SECURITY— y puede además vivir en algún complejo.
 *    Antes RESIDENT_ROL era excluyente en la práctica, y
 *    `UsersService.getEffectiveUserRoles` fabricaba
 *    un rol de residente VIRTUAL para que la interfaz no se viera rota. Ese
 *    rol virtual nunca llegaba al JWT, así que la app de residente quedaba
 *    inalcanzable para esas cuentas. Acá se vuelve real.
 *
 * Consecuencia para las dos: sin RESIDENT_ROL no podían entrar por ningún canal
 * de residente (WhatsApp entrante, OTP, código de sistema) porque los tres lo
 * exigen, ni usar resolvers con @Auth({ roles: [RESIDENT_ROL] }) —zonas
 * comunes, aprobación de dispositivos, PQRF—.
 *
 * Queda fuera COMPLEX_ROL (la cuenta del complejo no es un usuario) y
 * MAINTENANCE_ROL (todavía no inicia sesión). COUNCIL_ROL no hace falta: quien
 * lo tiene ya es residente.
 *
 * Sobre privilegios: dar RESIDENT_ROL a una cuenta administrativa la habilita a
 * entrar por los canales de residente, que prueban posesión del teléfono y no
 * la contraseña. Eso es seguro únicamente porque esas sesiones salen acotadas
 * —ver la migración RefreshTokenRoleScope y RESIDENT_SESSION_ROLES—: el token
 * que emiten lleva RESIDENT_ROL y nada más. Sin ese recorte, esta migración
 * abriría una vía para obtener sesión de administrador con solo un WhatsApp.
 *
 * Alcance del punto 1: solo residencias ACTIVE y SUSPENDED. Una suspensión es
 * temporal y casi siempre por cartera, y el residente necesita la app justo
 * para ponerse al día. PENDING_APPROVAL, REJECTED y MOVED_OUT quedan fuera a
 * propósito: asignarles el rol sería conceder un acceso que nadie aprobó.
 *
 * `is_primary` se marca solo si la cuenta no tenía ningún otro rol. Para quien
 * administra y además reside, el rol principal sigue siendo el suyo: es el que
 * decide a dónde entra al iniciar sesión con correo y contraseña.
 *
 * Idempotente: el NOT EXISTS final de cada sentencia evita duplicar el rol si
 * se corre dos veces.
 */
export class BackfillResidentRole1781006500000 implements MigrationInterface {
  name = 'BackfillResidentRole1781006500000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const byResidence = await this.grantResidentRole(
      queryRunner,
      `EXISTS (
         SELECT 1 FROM "residents" res
          WHERE res."user_id" = u."id"
            AND res."deleted_at" IS NULL
            AND res."status" IN ('ACTIVE', 'SUSPENDED')
       )`,
    );

    const byStaffRole = await this.grantResidentRole(
      queryRunner,
      `EXISTS (
         SELECT 1 FROM "user_has_roles" uhr
           JOIN "roles" ro ON ro."id" = uhr."role_id"
          WHERE uhr."user_id" = u."id"
            AND ro."name" IN (
              'SUPER_ADMIN_ROL',
              'COMPILANCE_OFFICER_ROL',
              'ACCOUNTANT_ROL',
              'SUPERVISOR_ROL',
              'SECURITY_ROL'
            )
       )`,
    );

    console.log(
      `[BackfillResidentRole] RESIDENT_ROL asignado a ${byResidence} residente(s) sin el rol ` +
        `y a ${byStaffRole} cuenta(s) con cargo en la plataforma.`,
    );
  }

  public async down(): Promise<void> {
    // Sin vuelta atrás: una vez asignado, el rol es indistinguible del que
    // habría puesto el alta normal. Revocarlos en bloque dejaría fuera de la
    // app a residentes legítimos, que es peor que el estado que esta migración
    // corrige.
  }

  /**
   * Asigna RESIDENT_ROL a los usuarios vivos que cumplan `condition` y todavía
   * no lo tengan. Devuelve cuántas filas creó.
   */
  private async grantResidentRole(
    queryRunner: QueryRunner,
    condition: string,
  ): Promise<number> {
    const inserted = (await queryRunner.query(`
      WITH resident_role AS (
        SELECT "id" FROM "roles" WHERE "name" = 'RESIDENT_ROL' LIMIT 1
      )
      INSERT INTO "user_has_roles" ("id", "user_id", "role_id", "is_primary", "assigned_at")
      SELECT
        gen_random_uuid(),
        u."id",
        rr."id",
        NOT EXISTS (
          SELECT 1 FROM "user_has_roles" x WHERE x."user_id" = u."id"
        ),
        NOW()
      FROM "users" u
      CROSS JOIN resident_role rr
      WHERE u."deleted_at" IS NULL
        AND ${condition}
        AND NOT EXISTS (
          SELECT 1 FROM "user_has_roles" ur
          WHERE ur."user_id" = u."id" AND ur."role_id" = rr."id"
        )
      RETURNING "user_id"
    `)) as { user_id: string }[];

    return inserted?.length ?? 0;
  }
}
