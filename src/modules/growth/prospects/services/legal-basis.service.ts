import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { JwtAccessPayload } from '../../../shared/interfaces/jwt-payload.interface';
import { CustomError } from '../../../shared/utils/errors.utils';
import { ActivityLogService } from '../../activity/services/activity-log.service';
import { GrowthErrorCode } from '../../shared/growth-error-codes';
import { GrowthEntityType } from '../../shared/growth.enums';
import { Person } from '../entities/person.entity';
import {
  GrowthContactStatus,
  GrowthLegalBasis,
  GrowthProspectKind,
  GrowthValidationStatus,
} from '../prospects.enums';
import {
  GrowthSetContactStatusInput,
  GrowthSetLegalBasisInput,
} from '../dto/inputs/relations.inputs';
import { ProspectGuardsService } from './prospect-guards.service';

/**
 * Base jurídica y autorización de contacto de una persona.
 *
 * Bloqueo jurídico (en la aplicación Y en la base):
 *  - con PENDING_LEGAL_REVIEW no se autoriza contacto (CHECK
 *    ck_growth_people_contact_requires_basis);
 *  - volver a PENDING_LEGAL_REVIEW revoca en la misma operación un contacto
 *    autorizado;
 *  - autorizar exige además persona VALIDATED y no anonimizada.
 * Que un dato sea público NO autoriza contacto por sí solo.
 */
@Injectable()
export class LegalBasisService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly guards: ProspectGuardsService,
    private readonly activity: ActivityLogService,
  ) {}

  async setLegalBasis(
    personId: string,
    input: GrowthSetLegalBasisInput,
    actor: JwtAccessPayload,
  ): Promise<Person> {
    return this.dataSource.transaction(async (manager) => {
      const person = await this.guards.findVisible<Person>(
        manager,
        GrowthProspectKind.PERSON,
        personId,
        actor,
        true,
      );
      const pending =
        input.legalBasis === GrowthLegalBasis.PENDING_LEGAL_REVIEW;
      if (!pending && !input.reference?.trim()) {
        throw new CustomError({
          message:
            'Una base jurídica distinta de pendiente exige referencia documentada',
          statusCode: HttpStatus.BAD_REQUEST,
          errorCode: GrowthErrorCode.GROWTH_INVALID_INPUT,
        });
      }
      const before = {
        legalBasis: person.legalBasis,
        contactStatus: person.contactStatus,
      };

      person.legalBasis = input.legalBasis;
      if (input.processingPurpose)
        person.processingPurpose = input.processingPurpose.trim();
      if (pending) {
        person.legalBasisReference = null;
        person.legalBasisReviewedByUserId = null;
        person.legalBasisReviewedAt = null;
        if (person.contactStatus === GrowthContactStatus.AUTHORIZED) {
          person.contactStatus = GrowthContactStatus.REVOKED;
          person.contactStatusReason =
            'Base jurídica devuelta a revisión pendiente';
        }
      } else {
        person.legalBasisReference = (input.reference ?? '').trim();
        person.legalBasisReviewedByUserId = actor.sub;
        person.legalBasisReviewedAt = new Date();
      }
      person.updatedByUserId = actor.sub;
      await manager.save(person);
      await this.activity.record(manager, actor, {
        action: 'LEGAL_BASIS_SET',
        entityType: GrowthEntityType.PERSON,
        entityId: personId,
        changes: {
          legalBasis: { from: before.legalBasis, to: person.legalBasis },
          contactStatus: {
            from: before.contactStatus,
            to: person.contactStatus,
          },
          reference: person.legalBasisReference ?? null,
          purposeChanged: !!input.processingPurpose,
        },
      });
      return manager.findOneOrFail(Person, { where: { id: personId } });
    });
  }

  async setContactStatus(
    personId: string,
    input: GrowthSetContactStatusInput,
    actor: JwtAccessPayload,
  ): Promise<Person> {
    return this.dataSource.transaction(async (manager) => {
      const person = await this.guards.findVisible<Person>(
        manager,
        GrowthProspectKind.PERSON,
        personId,
        actor,
        true,
      );
      const previous = person.contactStatus;

      if (input.status === GrowthContactStatus.AUTHORIZED) {
        if (
          person.legalBasis === GrowthLegalBasis.PENDING_LEGAL_REVIEW ||
          !person.legalBasisReference
        ) {
          throw new CustomError({
            message:
              'No se autoriza contacto con la base jurídica pendiente de revisión',
            statusCode: HttpStatus.CONFLICT,
            errorCode: GrowthErrorCode.GROWTH_LEGAL_BASIS_PENDING,
          });
        }
        if (
          person.anonymizedAt ||
          person.validationStatus !== GrowthValidationStatus.VALIDATED
        ) {
          throw new CustomError({
            message:
              'Solo se autoriza contacto de una persona validada y no anonimizada',
            statusCode: HttpStatus.CONFLICT,
            errorCode: GrowthErrorCode.GROWTH_VALIDATION_INCOMPLETE,
          });
        }
        person.contactAuthorizedByUserId = actor.sub;
        person.contactAuthorizedAt = new Date();
      }
      person.contactStatus = input.status;
      person.contactStatusReason = input.reason.trim();
      person.updatedByUserId = actor.sub;
      await manager.save(person);
      await this.activity.record(manager, actor, {
        action:
          input.status === GrowthContactStatus.AUTHORIZED
            ? 'CONTACT_AUTHORIZED'
            : 'CONTACT_REVOKED',
        entityType: GrowthEntityType.PERSON,
        entityId: personId,
        changes: {
          contactStatus: { from: previous, to: input.status },
          legalBasis: person.legalBasis,
          reason: input.reason.trim(),
        },
      });
      return manager.findOneOrFail(Person, { where: { id: personId } });
    });
  }
}
