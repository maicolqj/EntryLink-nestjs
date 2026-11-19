import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { JwtAccessPayload } from '../../../shared/interfaces/jwt-payload.interface';
import { CustomError } from '../../../shared/utils/errors.utils';
import { ActivityLogService } from '../../activity/services/activity-log.service';
import { SuppressionsService } from '../../compliance/services/suppressions.service';
import { GrowthErrorCode } from '../../shared/growth-error-codes';
import {
  GrowthEntityType,
  GrowthIdentifierType,
} from '../../shared/growth.enums';
import { normalizeIdentifier } from '../../shared/identifier-normalizer';
import {
  OrganizationChannel,
  PersonChannel,
} from '../entities/channels.entity';
import { Organization } from '../entities/organization.entity';
import { Person } from '../entities/person.entity';
import { GrowthChannelKind, GrowthProspectKind } from '../prospects.enums';
import {
  GrowthChannelInput,
  GrowthPersonChannelInput,
} from '../dto/inputs/relations.inputs';
import { EvidencesService } from './evidences.service';
import { ProspectGuardsService } from './prospect-guards.service';

/**
 * Canales de contacto. Antes de almacenar un correo o teléfono se consulta la
 * lista de exclusión: si está excluido NO se guarda, y el evento queda sin el
 * dato. Un canal no se borra físicamente (deleted_at).
 */
@Injectable()
export class ChannelsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly guards: ProspectGuardsService,
    private readonly evidences: EvidencesService,
    private readonly suppressions: SuppressionsService,
    private readonly activity: ActivityLogService,
  ) {}

  async addToOrganization(
    organizationId: string,
    input: GrowthChannelInput,
    actor: JwtAccessPayload,
  ): Promise<OrganizationChannel> {
    const normalized = this.normalize(input);
    await this.assertNotSuppressed(input.kind, normalized, actor, {
      entityType: GrowthEntityType.ORGANIZATION,
      entityId: organizationId,
    });
    return this.dataSource.transaction(async (manager) => {
      await this.guards.findVisible<Organization>(
        manager,
        GrowthProspectKind.ORGANIZATION,
        organizationId,
        actor,
      );
      await this.guards.assertSourceUsable(manager, input.source);
      const channel = await manager.save(
        manager.create(OrganizationChannel, {
          organizationId,
          kind: input.kind,
          socialNetwork: input.socialNetwork?.toLowerCase() ?? null,
          value: input.value.trim(),
          valueNormalized: normalized,
          label: input.label ?? null,
          sourceId: input.source.sourceId,
          createdByUserId: actor.sub,
        }),
      );
      await this.afterAdd(
        manager,
        actor,
        GrowthEntityType.ORGANIZATION_CHANNEL,
        channel.id,
        input,
        {
          kind: input.kind,
          organizationId,
        },
      );
      return channel;
    });
  }

  async addToPerson(
    personId: string,
    input: GrowthPersonChannelInput,
    actor: JwtAccessPayload,
  ): Promise<PersonChannel> {
    const normalized = this.normalize(input);
    await this.assertNotSuppressed(input.kind, normalized, actor, {
      entityType: GrowthEntityType.PERSON,
      entityId: personId,
    });
    return this.dataSource.transaction(async (manager) => {
      const person = await this.guards.findVisible<Person>(
        manager,
        GrowthProspectKind.PERSON,
        personId,
        actor,
      );
      if (person.anonymizedAt) {
        throw new CustomError({
          message: 'La persona fue anonimizada',
          statusCode: HttpStatus.CONFLICT,
          errorCode: GrowthErrorCode.GROWTH_INVALID_TRANSITION,
        });
      }
      await this.guards.assertSourceUsable(manager, input.source);
      const channel = await manager.save(
        manager.create(PersonChannel, {
          personId,
          kind: input.kind,
          channelClass: input.channelClass,
          socialNetwork: input.socialNetwork?.toLowerCase() ?? null,
          value: input.value.trim(),
          valueNormalized: normalized,
          label: input.label ?? null,
          sourceId: input.source.sourceId,
          createdByUserId: actor.sub,
        }),
      );
      // El evento no lleva el valor: es dato personal.
      await this.afterAdd(
        manager,
        actor,
        GrowthEntityType.PERSON_CHANNEL,
        channel.id,
        input,
        {
          kind: input.kind,
          channelClass: input.channelClass,
          personId,
        },
      );
      return channel;
    });
  }

  /** Verificar un canal: quien lo registró no lo verifica (con excepción). */
  async verify(
    kind: GrowthProspectKind.ORGANIZATION | GrowthProspectKind.PERSON,
    channelId: string,
    actor: JwtAccessPayload,
  ): Promise<OrganizationChannel | PersonChannel> {
    return this.dataSource.transaction(async (manager) => {
      const { channel, entityType } = await this.findChannel(
        manager,
        kind,
        channelId,
        actor,
      );
      await this.guards.assertSegregation(manager, actor, {
        registeredByUserId: channel.createdByUserId,
        operation: 'CHANNEL_VERIFIED',
        entityType,
        entityId: channel.id,
      });
      channel.verifiedAt = new Date();
      channel.verifiedByUserId = actor.sub;
      const saved = await manager.save(channel);
      await this.activity.record(manager, actor, {
        action: 'CHANNEL_VERIFIED',
        entityType,
        entityId: channel.id,
        changes: { kind: channel.kind },
      });
      return saved;
    });
  }

  async remove(
    kind: GrowthProspectKind.ORGANIZATION | GrowthProspectKind.PERSON,
    channelId: string,
    actor: JwtAccessPayload,
  ): Promise<boolean> {
    return this.dataSource.transaction(async (manager) => {
      const { channel, entityType } = await this.findChannel(
        manager,
        kind,
        channelId,
        actor,
      );
      await manager.softRemove(channel);
      await this.activity.record(manager, actor, {
        action: 'CHANNEL_REMOVED',
        entityType,
        entityId: channel.id,
        changes: { kind: channel.kind },
      });
      return true;
    });
  }

  listForOrganization(organizationId: string): Promise<OrganizationChannel[]> {
    return this.dataSource.manager.find(OrganizationChannel, {
      where: { organizationId },
      order: { createdAt: 'ASC' },
    });
  }

  listForPerson(personId: string): Promise<PersonChannel[]> {
    return this.dataSource.manager.find(PersonChannel, {
      where: { personId },
      order: { createdAt: 'ASC' },
    });
  }

  private normalize(input: GrowthChannelInput): string {
    const fail = () =>
      new CustomError({
        message: `El canal ${input.kind.toLowerCase()} no es válido`,
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: GrowthErrorCode.GROWTH_INVALID_IDENTIFIER,
      });
    if ((input.kind === GrowthChannelKind.SOCIAL) !== !!input.socialNetwork) {
      throw new CustomError({
        message: 'socialNetwork se indica solo (y siempre) para canales SOCIAL',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: GrowthErrorCode.GROWTH_INVALID_INPUT,
      });
    }
    const map: Partial<Record<GrowthChannelKind, GrowthIdentifierType>> = {
      [GrowthChannelKind.EMAIL]: GrowthIdentifierType.EMAIL,
      [GrowthChannelKind.PHONE]: GrowthIdentifierType.PHONE,
      [GrowthChannelKind.WEBSITE]: GrowthIdentifierType.DOMAIN,
    };
    const type = map[input.kind];
    if (!type) return input.value.trim().toLowerCase();
    const normalized = normalizeIdentifier(type, input.value);
    if (!normalized) throw fail();
    return normalized;
  }

  /**
   * Correo: se consulta el correo y su dominio. Teléfono: el número. Si está
   * excluido se rechaza y se registra el intento sin el dato.
   */
  private async assertNotSuppressed(
    kind: GrowthChannelKind,
    normalized: string,
    actor: JwtAccessPayload,
    owner: { entityType: GrowthEntityType; entityId: string },
  ): Promise<void> {
    const checks: Array<[GrowthIdentifierType, string]> = [];
    if (kind === GrowthChannelKind.EMAIL) {
      checks.push([GrowthIdentifierType.EMAIL, normalized]);
      checks.push([GrowthIdentifierType.DOMAIN, normalized.split('@')[1]]);
    } else if (kind === GrowthChannelKind.PHONE) {
      checks.push([GrowthIdentifierType.PHONE, normalized]);
    } else if (kind === GrowthChannelKind.WEBSITE) {
      checks.push([GrowthIdentifierType.DOMAIN, normalized]);
    }
    for (const [identifierType, value] of checks) {
      if (await this.suppressions.isSuppressed({ identifierType, value })) {
        await this.dataSource.transaction((manager) =>
          this.activity.record(manager, actor, {
            action: 'CHANNEL_REJECTED_SUPPRESSED',
            entityType: owner.entityType,
            entityId: owner.entityId,
            changes: { kind, matchedOn: identifierType },
          }),
        );
        throw new CustomError({
          message:
            'El dato está en la lista de exclusión comercial y no se almacena',
          statusCode: HttpStatus.CONFLICT,
          errorCode: GrowthErrorCode.GROWTH_CHANNEL_SUPPRESSED,
        });
      }
    }
  }

  private async afterAdd(
    manager: EntityManager,
    actor: JwtAccessPayload,
    entityType: GrowthEntityType,
    channelId: string,
    input: GrowthChannelInput,
    changes: Record<string, unknown>,
  ): Promise<void> {
    await this.evidences.recordFields(
      manager,
      actor,
      { entityType, entityId: channelId },
      { value: input.value.trim() },
      input.source,
    );
    await this.activity.record(manager, actor, {
      action: 'CHANNEL_ADDED',
      entityType,
      entityId: channelId,
      changes,
    });
  }

  private async findChannel(
    manager: EntityManager,
    kind: GrowthProspectKind.ORGANIZATION | GrowthProspectKind.PERSON,
    channelId: string,
    actor: JwtAccessPayload,
  ): Promise<{
    channel: OrganizationChannel | PersonChannel;
    entityType: GrowthEntityType;
  }> {
    const isOrg = kind === GrowthProspectKind.ORGANIZATION;
    const channel = isOrg
      ? await manager.findOne(OrganizationChannel, { where: { id: channelId } })
      : await manager.findOne(PersonChannel, { where: { id: channelId } });
    if (!channel) {
      throw new CustomError({
        message: 'Canal no encontrado',
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: GrowthErrorCode.GROWTH_NOT_FOUND,
      });
    }
    const ownerId = isOrg
      ? (channel as OrganizationChannel).organizationId
      : (channel as PersonChannel).personId;
    await this.guards.findVisible(manager, kind, ownerId, actor);
    return {
      channel,
      entityType: isOrg
        ? GrowthEntityType.ORGANIZATION_CHANNEL
        : GrowthEntityType.PERSON_CHANNEL,
    };
  }
}
