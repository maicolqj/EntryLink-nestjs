import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { JwtAccessPayload } from '../../../shared/interfaces/jwt-payload.interface';
import { ActivityLogService } from '../../activity/services/activity-log.service';
import { GrowthEntityType } from '../../shared/growth.enums';
import { GrowthSettings } from '../entities/growth-settings.entity';
import { GrowthValidationStatus } from '../prospects.enums';
import { GrowthUpdateSettingsInput } from '../dto/inputs/relations.inputs';
import {
  GrowthKindStats,
  GrowthProspectDashboard,
} from '../dto/responses/prospect.responses';

/**
 * Dashboard de Prospect (agregados, sin datos personales) y configuración
 * de la suite. Las prioridades llegan con el scoring (1B).
 */
@Injectable()
export class ProspectDashboardService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly activity: ActivityLogService,
  ) {}

  async dashboard(actor: JwtAccessPayload): Promise<GrowthProspectDashboard> {
    const settings = await this.settings();
    const [organizations, independentAdmins, properties] = await Promise.all([
      this.stats('growth.organizations', ''),
      this.stats('growth.people', 'AND is_independent_admin'),
      this.stats('growth.properties', ''),
    ]);
    const [units]: Array<{ verified: number; estimated: number }> =
      await this.dataSource.query(
        `SELECT coalesce(sum(estimated_units) FILTER (WHERE validation_status = 'VALIDATED'), 0)::int AS verified,
                coalesce(sum(estimated_units) FILTER (WHERE validation_status <> 'VALIDATED'), 0)::int AS estimated
           FROM growth.properties WHERE deleted_at IS NULL`,
      );
    const count = (s: GrowthKindStats, ...statuses: GrowthValidationStatus[]) =>
      s.byStatus
        .filter((b) => statuses.includes(b.status))
        .reduce((acc, b) => acc + b.count, 0);
    const recent = await this.activity.list(actor, {}, { page: 1, limit: 20 });

    return {
      goal: settings.prospectGoal,
      validatedProspects:
        count(organizations, GrowthValidationStatus.VALIDATED) +
        count(independentAdmins, GrowthValidationStatus.VALIDATED),
      pendingValidation: [organizations, independentAdmins, properties].reduce(
        (acc, s) =>
          acc +
          count(
            s,
            GrowthValidationStatus.PENDING_REVIEW,
            GrowthValidationStatus.IN_VALIDATION,
          ),
        0,
      ),
      organizations,
      independentAdmins,
      properties,
      verifiedUnits: units.verified,
      estimatedUnits: units.estimated,
      recentActivity: recent.items,
    };
  }

  async settings(): Promise<GrowthSettings> {
    return this.dataSource.manager.findOneOrFail(GrowthSettings, {
      where: { id: 1 },
    });
  }

  async updateSettings(
    input: GrowthUpdateSettingsInput,
    actor: JwtAccessPayload,
  ): Promise<GrowthSettings> {
    return this.dataSource.transaction(async (manager) => {
      const settings = await manager.findOneOrFail(GrowthSettings, {
        where: { id: 1 },
        lock: { mode: 'pessimistic_write' },
      });
      const before = { ...settings };
      if (input.allowSuperAdminSelfValidation !== undefined) {
        settings.allowSuperAdminSelfValidation =
          input.allowSuperAdminSelfValidation;
      }
      if (input.prospectGoal !== undefined)
        settings.prospectGoal = input.prospectGoal;
      settings.updatedAt = new Date();
      settings.updatedByUserId = actor.sub;
      const saved = await manager.save(settings);
      await this.activity.record(manager, actor, {
        action: 'SETTINGS_UPDATED',
        entityType: GrowthEntityType.SETTINGS,
        // Fila única: id fijo para poder filtrar su historial.
        entityId: '00000000-0000-0000-0000-000000000001',
        changes: {
          allowSuperAdminSelfValidation: {
            from: before.allowSuperAdminSelfValidation,
            to: saved.allowSuperAdminSelfValidation,
          },
          prospectGoal: { from: before.prospectGoal, to: saved.prospectGoal },
        },
      });
      return saved;
    });
  }

  private async stats(table: string, extra: string): Promise<GrowthKindStats> {
    const rows: Array<{ status: GrowthValidationStatus; count: number }> =
      await this.dataSource.query(
        `SELECT validation_status AS status, count(*)::int AS count
           FROM ${table} WHERE deleted_at IS NULL ${extra}
          GROUP BY validation_status`,
      );
    return {
      total: rows.reduce((acc, r) => acc + r.count, 0),
      byStatus: rows,
    };
  }
}
