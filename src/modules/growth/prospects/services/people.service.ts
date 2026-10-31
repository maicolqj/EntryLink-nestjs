import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { PaginationInput } from '../../../shared/dto/inputs/pagination.input';
import { JwtAccessPayload } from '../../../shared/interfaces/jwt-payload.interface';
import { CustomError } from '../../../shared/utils/errors.utils';
import { ActivityLogService } from '../../activity/services/activity-log.service';
import { safeDiff } from '../../shared/growth-actor';
import { GrowthErrorCode } from '../../shared/growth-error-codes';
import { GrowthEntityType } from '../../shared/growth.enums';
import { GrowthDataSource } from '../../sources/entities/growth-data-source.entity';
import { Person } from '../entities/person.entity';
import {
  GrowthContactStatus,
  GrowthLegalBasis,
  GrowthProspectKind,
} from '../prospects.enums';
import {
  GrowthCreatePersonInput,
  GrowthProspectFilterInput,
  GrowthUpdatePersonInput,
} from '../dto/inputs/prospect.inputs';
import {
  PaginatedGrowthPeople,
  paginate,
} from '../dto/responses/prospect.responses';
import { normalizePersonName } from '../shared/prospect-normalizers';
import { EvidencesService } from './evidences.service';
import { ProspectGuardsService } from './prospect-guards.service';
import { applyProspectFilter, requireRevalidation } from './prospect-helpers';

/**
 * Las personas nacen con base jurídica PENDING_LEGAL_REVIEW y contacto
 * NOT_AUTHORIZED. Desde aquí no se puede cambiar ninguna de las dos: eso
 * lo hace LegalBasisService con permisos propios.
 */
const SAFE_FIELDS: (keyof Person)[] = [
  'isIndependentAdmin',
  'legalBasis',
  'contactStatus',
  'validationStatus',
];

@Injectable()
export class PeopleService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly guards: ProspectGuardsService,
    private readonly evidences: EvidencesService,
    private readonly activity: ActivityLogService,
  ) {}

  async list(
    actor: JwtAccessPayload,
    filter: GrowthProspectFilterInput = {},
    pagination: PaginationInput = { page: 1, limit: 25 },
  ): Promise<PaginatedGrowthPeople> {
    const qb = this.dataSource.manager
      .createQueryBuilder(Person, 'e')
      .orderBy('e.updatedAt', 'DESC')
      .skip((pagination.page - 1) * pagination.limit)
      .take(pagination.limit);
    applyProspectFilter(
      qb,
      GrowthProspectKind.PERSON,
      filter,
      this.guards,
      actor,
      ['e.name_normalized'],
    );
    const [items, total] = await qb.getManyAndCount();
    return paginate(items, total, pagination);
  }

  get(id: string, actor: JwtAccessPayload): Promise<Person> {
    return this.guards.findVisible(
      this.dataSource.manager,
      GrowthProspectKind.PERSON,
      id,
      actor,
    );
  }

  async create(
    input: GrowthCreatePersonInput,
    actor: JwtAccessPayload,
  ): Promise<Person> {
    return this.dataSource.transaction(async (manager) => {
      await this.guards.assertSourceUsable(manager, input.source);
      const source = await manager.findOneOrFail(GrowthDataSource, {
        where: { id: input.source.sourceId },
      });
      const person = await manager.save(
        manager.create(Person, {
          fullName: input.fullName.trim(),
          nameNormalized: normalizePersonName(input.fullName),
          isIndependentAdmin: input.isIndependentAdmin,
          // Trazabilidad de la finalidad: la explícita o la de la fuente.
          processingPurpose:
            input.processingPurpose?.trim() || source.processingPurpose,
          legalBasis: GrowthLegalBasis.PENDING_LEGAL_REVIEW,
          contactStatus: GrowthContactStatus.NOT_AUTHORIZED,
          sourceId: input.source.sourceId,
          createdByUserId: actor.sub,
          updatedByUserId: actor.sub,
        }),
      );
      await this.evidences.recordFields(
        manager,
        actor,
        { entityType: GrowthEntityType.PERSON, entityId: person.id },
        {
          fullName: input.fullName.trim(),
          isIndependentAdmin: input.isIndependentAdmin,
        },
        input.source,
      );
      // El nombre no va al registro de actividad: es dato personal.
      await this.activity.record(manager, actor, {
        action: 'PERSON_CREATED',
        entityType: GrowthEntityType.PERSON,
        entityId: person.id,
        changes: safeDiff(null, person, SAFE_FIELDS),
      });
      // retention_review_at lo calcula un trigger: se recarga la fila.
      return manager.findOneOrFail(Person, { where: { id: person.id } });
    });
  }

  async update(
    id: string,
    input: GrowthUpdatePersonInput,
    actor: JwtAccessPayload,
  ): Promise<Person> {
    return this.dataSource.transaction(async (manager) => {
      const person = await this.guards.findVisible<Person>(
        manager,
        GrowthProspectKind.PERSON,
        id,
        actor,
        true,
      );
      if (person.anonymizedAt) {
        throw new CustomError({
          message: 'La persona fue anonimizada y no se edita',
          statusCode: HttpStatus.CONFLICT,
          errorCode: GrowthErrorCode.GROWTH_INVALID_TRANSITION,
        });
      }
      await this.guards.assertSourceUsable(manager, input.source);
      const before = { ...person };
      if (input.fullName) {
        person.fullName = input.fullName.trim();
        person.nameNormalized = normalizePersonName(input.fullName);
      }
      if (input.isIndependentAdmin !== undefined) {
        person.isIndependentAdmin = input.isIndependentAdmin;
      }
      const revalidate = requireRevalidation(person, before, ['fullName']);
      person.updatedByUserId = actor.sub;
      const saved = await manager.save(person);
      await this.evidences.recordFields(
        manager,
        actor,
        { entityType: GrowthEntityType.PERSON, entityId: id },
        {
          fullName: input.fullName?.trim(),
          isIndependentAdmin: input.isIndependentAdmin,
        },
        input.source,
      );
      await this.activity.record(manager, actor, {
        action: revalidate ? 'PERSON_UPDATED_REVALIDATION' : 'PERSON_UPDATED',
        entityType: GrowthEntityType.PERSON,
        entityId: id,
        changes: safeDiff(before, saved, SAFE_FIELDS),
      });
      return manager.findOneOrFail(Person, { where: { id } });
    });
  }
}
