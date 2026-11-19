import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, IsNull, Not } from 'typeorm';
import { PaginationInput } from '../../../shared/dto/inputs/pagination.input';
import { JwtAccessPayload } from '../../../shared/interfaces/jwt-payload.interface';
import { CustomError } from '../../../shared/utils/errors.utils';
import { ActivityLogService } from '../../activity/services/activity-log.service';
import { definedOnly, safeDiff } from '../../shared/growth-actor';
import { GrowthErrorCode } from '../../shared/growth-error-codes';
import {
  GrowthEntityType,
  GrowthIdentifierType,
} from '../../shared/growth.enums';
import { normalizeIdentifier } from '../../shared/identifier-normalizer';
import { Organization } from '../entities/organization.entity';
import { GrowthProspectKind } from '../prospects.enums';
import {
  GrowthCreateOrganizationInput,
  GrowthOrganizationFieldsInput,
  GrowthProspectFilterInput,
  GrowthUpdateOrganizationInput,
} from '../dto/inputs/prospect.inputs';
import {
  PaginatedGrowthOrganizations,
  paginate,
} from '../dto/responses/prospect.responses';
import {
  nitCheckDigit,
  normalizeBogotaAddress,
  normalizeOrganizationName,
  splitNit,
  stripAccents,
} from '../shared/prospect-normalizers';
import { EvidencesService } from './evidences.service';
import { ProspectGuardsService } from './prospect-guards.service';
import { applyProspectFilter, requireRevalidation } from './prospect-helpers';

/** Campos cuyo cambio exige revalidar una empresa VALIDATED. */
const CRITICAL: (keyof Organization)[] = ['legalName', 'nit'];

const SAFE_FIELDS: (keyof Organization)[] = [
  'legalName',
  'tradeName',
  'nit',
  'website',
  'domain',
  'address',
  'city',
  'locality',
  'estimatedProperties',
  'estimatedUnits',
  'interestSignal',
  'validationStatus',
];

@Injectable()
export class OrganizationsService {
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
  ): Promise<PaginatedGrowthOrganizations> {
    const qb = this.dataSource.manager
      .createQueryBuilder(Organization, 'e')
      .orderBy('e.updatedAt', 'DESC')
      .skip((pagination.page - 1) * pagination.limit)
      .take(pagination.limit);
    applyProspectFilter(
      qb,
      GrowthProspectKind.ORGANIZATION,
      filter,
      this.guards,
      actor,
      ['e.name_normalized', 'e.nit', 'e.legal_name', 'e.trade_name'],
    );
    const [items, total] = await qb.getManyAndCount();
    return paginate(items, total, pagination);
  }

  get(id: string, actor: JwtAccessPayload): Promise<Organization> {
    return this.guards.findVisible(
      this.dataSource.manager,
      GrowthProspectKind.ORGANIZATION,
      id,
      actor,
    );
  }

  async create(
    input: GrowthCreateOrganizationInput,
    actor: JwtAccessPayload,
  ): Promise<Organization> {
    return this.dataSource.transaction(async (manager) => {
      await this.guards.assertSourceUsable(manager, input.source);
      const fields = this.prepare(input);
      await this.assertNitFree(manager, fields.nit);
      const org = await manager.save(
        manager.create(Organization, {
          ...fields,
          sourceId: input.source.sourceId,
          createdByUserId: actor.sub,
          updatedByUserId: actor.sub,
        }),
      );
      await this.evidences.recordFields(
        manager,
        actor,
        { entityType: GrowthEntityType.ORGANIZATION, entityId: org.id },
        evidenceFields(input),
        input.source,
      );
      await this.activity.record(manager, actor, {
        action: 'ORGANIZATION_CREATED',
        entityType: GrowthEntityType.ORGANIZATION,
        entityId: org.id,
        changes: safeDiff(null, org, SAFE_FIELDS),
      });
      return org;
    });
  }

  async update(
    id: string,
    input: GrowthUpdateOrganizationInput,
    actor: JwtAccessPayload,
  ): Promise<Organization> {
    return this.dataSource.transaction(async (manager) => {
      const org = await this.guards.findVisible<Organization>(
        manager,
        GrowthProspectKind.ORGANIZATION,
        id,
        actor,
        true,
      );
      await this.guards.assertSourceUsable(manager, input.source);
      const fields = definedOnly(this.prepare(input));
      if (fields.nit && fields.nit !== org.nit) {
        await this.assertNitFree(manager, fields.nit, id);
      }
      const before = { ...org };
      Object.assign(org, fields);
      const revalidate = requireRevalidation(org, before, CRITICAL);
      org.updatedByUserId = actor.sub;
      const saved = await manager.save(org);

      await this.evidences.recordFields(
        manager,
        actor,
        { entityType: GrowthEntityType.ORGANIZATION, entityId: id },
        evidenceFields(input),
        input.source,
      );
      await this.activity.record(manager, actor, {
        action: revalidate
          ? 'ORGANIZATION_UPDATED_REVALIDATION'
          : 'ORGANIZATION_UPDATED',
        entityType: GrowthEntityType.ORGANIZATION,
        entityId: id,
        changes: safeDiff(before, saved, SAFE_FIELDS),
      });
      return saved;
    });
  }

  private prepare(input: GrowthOrganizationFieldsInput): Partial<Organization> {
    const out: Partial<Organization> = {
      legalName: input.legalName?.trim(),
      tradeName: input.tradeName?.trim(),
      address: input.address?.trim(),
      city: input.city ? normalizeCity(input.city) : undefined,
      locality: input.locality,
      estimatedProperties: input.estimatedProperties,
      estimatedUnits: input.estimatedUnits,
      interestSignal: input.interestSignal,
    };
    if (input.legalName)
      out.nameNormalized = normalizeOrganizationName(input.legalName);
    if (input.address)
      out.addressNormalized = normalizeBogotaAddress(input.address);
    if (input.website) {
      const domain = normalizeIdentifier(
        GrowthIdentifierType.DOMAIN,
        input.website,
      );
      if (!domain) throw invalid('El sitio web no es válido');
      out.website = input.website.trim();
      out.domain = domain;
    }
    if (input.nit) {
      const parsed = splitNit(input.nit);
      if (!parsed) throw invalid('El NIT no es válido');
      const expected = nitCheckDigit(parsed.nit);
      if (parsed.checkDigit && parsed.checkDigit !== expected) {
        throw invalid('El dígito de verificación no corresponde al NIT');
      }
      out.nit = parsed.nit;
      out.nitCheckDigit = expected;
    }
    if (out.locality && out.city && out.city !== 'BOGOTA') {
      throw invalid('La localidad solo aplica a Bogotá');
    }
    return out;
  }

  private async assertNitFree(
    manager: EntityManager,
    nit: string | null | undefined,
    exceptId?: string,
  ): Promise<void> {
    if (!nit) return;
    const taken = await manager.findOne(Organization, {
      where: {
        nit,
        ...(exceptId ? { id: Not(exceptId) } : {}),
        deletedAt: IsNull(),
      },
    });
    if (taken) {
      // No se revela el id: el registro puede no ser visible para el actor.
      throw new CustomError({
        message: 'Ya existe una empresa con ese NIT',
        statusCode: HttpStatus.CONFLICT,
        errorCode: GrowthErrorCode.GROWTH_DUPLICATE_NIT,
      });
    }
  }
}

function evidenceFields(
  input: GrowthOrganizationFieldsInput,
): Record<string, unknown> {
  return {
    legalName: input.legalName,
    tradeName: input.tradeName,
    nit: input.nit,
    website: input.website,
    address: input.address,
    city: input.city,
    locality: input.locality,
    estimatedProperties: input.estimatedProperties,
    estimatedUnits: input.estimatedUnits,
    interestSignal: input.interestSignal,
  };
}

export function normalizeCity(city: string): string {
  const c = stripAccents(city).trim().toUpperCase();
  return ['BOGOTA', 'BOGOTA D.C.', 'BOGOTA DC', 'BOGOTA, D.C.'].includes(c)
    ? 'BOGOTA'
    : c;
}

export function invalid(message: string): CustomError {
  return new CustomError({
    message,
    statusCode: HttpStatus.BAD_REQUEST,
    errorCode: GrowthErrorCode.GROWTH_INVALID_INPUT,
  });
}
