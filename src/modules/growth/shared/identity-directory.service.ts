import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';

export interface GrowthIdentity {
  userId: string;
  roles: string[];
  /** Pertenece a un conjunto (cuenta del conjunto o cargo asignado). */
  linkedToComplex: boolean;
}

/**
 * ÚNICO punto de la suite que lee el esquema `public`, y solo la identidad:
 * existencia del usuario, sus roles y si está ligado a un conjunto. Nunca
 * datos de residentes ni de conjuntos.
 *
 * Es el puerto que habría que reemplazar si la suite se extrae a un servicio
 * aparte. La prueba de aislamiento falla si otro archivo de la suite consulta
 * `public.*`.
 */
@Injectable()
export class IdentityDirectoryService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async findActiveUser(
    userId: string,
    manager: EntityManager = this.dataSource.manager,
  ): Promise<GrowthIdentity | null> {
    const rows: Array<{
      id: string;
      complex_id: string | null;
      roles: string[] | null;
      assignments: number;
    }> = await manager.query(
      `SELECT u.id,
              u.complex_id,
              array_remove(array_agg(DISTINCT r.name::text), NULL) AS roles,
              (SELECT count(*)::int FROM public.user_complex_assignments a
                WHERE a.user_id = u.id AND a.removed_at IS NULL) AS assignments
         FROM public.users u
         LEFT JOIN public.user_has_roles uhr ON uhr.user_id = u.id
         LEFT JOIN public.roles r ON r.id = uhr.role_id
        WHERE u.id = $1 AND u.deleted_at IS NULL
        GROUP BY u.id`,
      [userId],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      userId: row.id,
      roles: row.roles ?? [],
      linkedToComplex: !!row.complex_id || row.assignments > 0,
    };
  }
}
