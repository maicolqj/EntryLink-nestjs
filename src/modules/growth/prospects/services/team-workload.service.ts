import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { GrowthTeamMemberStatus } from '../../shared/growth.enums';
import { GrowthValidationStatus } from '../prospects.enums';
import { GrowthTeamWorkload } from '../dto/responses/team-workload.responses';

interface Row {
  team_member_id: string;
  user_id: string;
  display_name: string;
  status: GrowthTeamMemberStatus;
  max_active_assignments: number | null;
  active: number;
  organizations: number;
  people: number;
  properties: number;
  high: number;
  stale: number;
  by_status: Record<string, number> | null;
}

/**
 * Carga de trabajo por responsable en UNA consulta. Qué se cuenta:
 * asignaciones vigentes (`ended_at IS NULL`), igual que el tope de
 * `AssignmentsService.assign`, para que la cifra y el bloqueo coincidan.
 * Los cortes por estado y por prioridad solo miran prospectos vivos; las
 * vigentes sobre un registro borrado o fusionado van en `staleAssignments`
 * (la fusión las mueve al sobreviviente, así que lo normal es 0). Nada más:
 * ni validaciones tomadas ni actividad, que tienen sus propias vistas.
 */
@Injectable()
export class TeamWorkloadService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async list(status?: GrowthTeamMemberStatus): Promise<GrowthTeamWorkload[]> {
    const rows: Row[] = await this.dataSource.query(
      `WITH open AS (
         SELECT a.team_member_id,
                CASE WHEN a.organization_id IS NOT NULL THEN 'ORGANIZATION'
                     WHEN a.person_id IS NOT NULL THEN 'PERSON'
                     ELSE 'PROPERTY' END AS kind,
                coalesce(o.validation_status, pe.validation_status, pr.validation_status) AS validation_status,
                coalesce(o.id, pe.id, pr.id) IS NOT NULL AS live,
                s.priority
           FROM growth.prospect_assignments a
           LEFT JOIN growth.organizations o
                  ON o.id = a.organization_id AND o.deleted_at IS NULL AND o.merged_into_id IS NULL
           LEFT JOIN growth.people pe
                  ON pe.id = a.person_id AND pe.deleted_at IS NULL AND pe.merged_into_id IS NULL
           LEFT JOIN growth.properties pr
                  ON pr.id = a.property_id AND pr.deleted_at IS NULL AND pr.merged_into_id IS NULL
           LEFT JOIN growth.prospect_scores s
                  ON s.organization_id = o.id OR s.person_id = pe.id
          WHERE a.ended_at IS NULL
       ),
       by_status AS (
         SELECT team_member_id, jsonb_object_agg(validation_status, n) AS by_status
           FROM (SELECT team_member_id, validation_status, count(*)::int AS n
                   FROM open WHERE live GROUP BY 1, 2) t
          GROUP BY 1
       )
       SELECT tm.id AS team_member_id, tm.user_id, tm.display_name, tm.status,
              tm.max_active_assignments,
              count(o.kind)::int AS active,
              count(*) FILTER (WHERE o.kind = 'ORGANIZATION')::int AS organizations,
              count(*) FILTER (WHERE o.kind = 'PERSON')::int AS people,
              count(*) FILTER (WHERE o.kind = 'PROPERTY')::int AS properties,
              count(*) FILTER (WHERE o.live AND o.priority = 'HIGH')::int AS high,
              count(*) FILTER (WHERE NOT o.live)::int AS stale,
              bs.by_status
         FROM growth.team_members tm
         LEFT JOIN open o ON o.team_member_id = tm.id
         LEFT JOIN by_status bs ON bs.team_member_id = tm.id
        WHERE ($1::text IS NULL OR tm.status = $1)
        GROUP BY tm.id, bs.by_status
        ORDER BY count(o.kind) DESC, tm.display_name ASC`,
      [status ?? null],
    );
    const order = Object.values(GrowthValidationStatus);
    return rows.map((r) => ({
      teamMemberId: r.team_member_id,
      userId: r.user_id,
      displayName: r.display_name,
      status: r.status,
      maxActiveAssignments: r.max_active_assignments,
      activeAssignments: r.active,
      organizations: r.organizations,
      people: r.people,
      properties: r.properties,
      highPriority: r.high,
      staleAssignments: r.stale,
      byValidationStatus: Object.entries(r.by_status ?? {})
        .map(([s, count]) => ({
          status: s as GrowthValidationStatus,
          count,
        }))
        .sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status)),
    }));
  }
}
