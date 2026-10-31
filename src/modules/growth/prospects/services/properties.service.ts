import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { PaginationInput } from '../../../shared/dto/inputs/pagination.input';
import { JwtAccessPayload } from '../../../shared/interfaces/jwt-payload.interface';
import { ActivityLogService } from '../../activity/services/activity-log.service';
import { definedOnly, safeDiff } from '../../shared/growth-actor';
import { GrowthEntityType } from '../../shared/growth.enums';
import { Property } from '../entities/property.entity';
import { GrowthProspectKind } from '../prospects.enums';
import {
  GrowthCreatePropertyInput,
  GrowthPropertyFieldsInput,
  GrowthProspectFilterInput,
  GrowthUpdatePropertyInput,
} from '../dto/inputs/prospect.inputs';
import {
  PaginatedGrowthProperties,
  paginate,
} from '../dto/responses/prospect.responses';
import {
  normalizeBogotaAddress,
  normalizePropertyName,
  normalizeRegistration,
  splitNit,
} from '../shared/prospect-normalizers';
import { EvidencesService } from './evidences.service';
import { invalid, normalizeCity } from './organizations.service';
import { ProspectGuardsService } from './prospect-guards.service';
import { applyProspectFilter, requireRevalidation } from './prospect-helpers';

const CRITICAL: (keyof Property)[] = ['name', 'address'];

const SAFE_FIELDS: (keyof Property)[] = [
  'name',
  'phType',
  'buildingKind',
  'address',
  'city',
  'locality',
  'neighborhood',
  'estimatedUnits',
  'realEstateRegistration',
  'nit',
  'infoStatus',
  'validationStatus',
];

@Injectable()
export class PropertiesService {
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
  ): Promise<PaginatedGrowthProperties> {
    const qb = this.dataSource.manager
      .createQueryBuilder(Property, 'e')
      .orderBy('e.updatedAt', 'DESC')
      .skip((pagination.page - 1) * pagination.limit)
      .take(pagination.limit);
    applyProspectFilter(
      qb,
      GrowthProspectKind.PROPERTY,
      filter,
      this.guards,
      actor,
      [
        'e.name_normalized',
        'e.address_normalized',
        'e.nit',
        'e.real_estate_registration',
      ],
    );
    const [items, total] = await qb.getManyAndCount();
    return paginate(items, total, pagination);
  }

  get(id: string, actor: JwtAccessPayload): Promise<Property> {
    return this.guards.findVisible(
      this.dataSource.manager,
      GrowthProspectKind.PROPERTY,
      id,
      actor,
    );
  }

  async create(
    input: GrowthCreatePropertyInput,
    actor: JwtAccessPayload,
  ): Promise<Property> {
    return this.dataSource.transaction(async (manager) => {
      await this.guards.assertSourceUsable(manager, input.source);
      const property = await manager.save(
        manager.create(Property, {
          ...prepare(input),
          sourceId: input.source.sourceId,
          createdByUserId: actor.sub,
          updatedByUserId: actor.sub,
        }),
      );
      await this.evidences.recordFields(
        manager,
        actor,
        { entityType: GrowthEntityType.PROPERTY, entityId: property.id },
        evidenceFields(input),
        input.source,
      );
      await this.activity.record(manager, actor, {
        action: 'PROPERTY_CREATED',
        entityType: GrowthEntityType.PROPERTY,
        entityId: property.id,
        changes: safeDiff(null, property, SAFE_FIELDS),
      });
      return property;
    });
  }

  async update(
    id: string,
    input: GrowthUpdatePropertyInput,
    actor: JwtAccessPayload,
  ): Promise<Property> {
    return this.dataSource.transaction(async (manager) => {
      const property = await this.guards.findVisible<Property>(
        manager,
        GrowthProspectKind.PROPERTY,
        id,
        actor,
        true,
      );
      await this.guards.assertSourceUsable(manager, input.source);
      const before = { ...property };
      Object.assign(property, definedOnly(prepare(input)));
      const revalidate = requireRevalidation(property, before, CRITICAL);
      property.updatedByUserId = actor.sub;
      const saved = await manager.save(property);
      await this.evidences.recordFields(
        manager,
        actor,
        { entityType: GrowthEntityType.PROPERTY, entityId: id },
        evidenceFields(input),
        input.source,
      );
      await this.activity.record(manager, actor, {
        action: revalidate
          ? 'PROPERTY_UPDATED_REVALIDATION'
          : 'PROPERTY_UPDATED',
        entityType: GrowthEntityType.PROPERTY,
        entityId: id,
        changes: safeDiff(before, saved, SAFE_FIELDS),
      });
      return saved;
    });
  }
}

function prepare(input: GrowthPropertyFieldsInput): Partial<Property> {
  const out: Partial<Property> = {
    name: input.name?.trim(),
    phType: input.phType,
    buildingKind: input.buildingKind,
    address: input.address?.trim(),
    city: input.city ? normalizeCity(input.city) : undefined,
    locality: input.locality,
    neighborhood: input.neighborhood?.trim(),
    estimatedUnits: input.estimatedUnits,
    infoStatus: input.infoStatus,
  };
  if (input.name) out.nameNormalized = normalizePropertyName(input.name);
  if (input.address)
    out.addressNormalized = normalizeBogotaAddress(input.address);
  if (input.realEstateRegistration) {
    out.realEstateRegistration = normalizeRegistration(
      input.realEstateRegistration,
    );
  }
  if (input.nit) {
    const parsed = splitNit(input.nit);
    if (!parsed) throw invalid('El NIT no es válido');
    out.nit = parsed.nit;
  }
  if (out.locality && out.city && out.city !== 'BOGOTA') {
    throw invalid('La localidad solo aplica a Bogotá');
  }
  return out;
}

function evidenceFields(
  input: GrowthPropertyFieldsInput,
): Record<string, unknown> {
  return {
    name: input.name,
    phType: input.phType,
    buildingKind: input.buildingKind,
    address: input.address,
    city: input.city,
    locality: input.locality,
    neighborhood: input.neighborhood,
    estimatedUnits: input.estimatedUnits,
    realEstateRegistration: input.realEstateRegistration,
    nit: input.nit,
  };
}
