import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';

import { Visitor }                  from '../entities/visitor.entity';
import { CreateVisitorInput }       from '../dto/inputs/create-visitor.input';
import { BlacklistVisitorInput }    from '../dto/inputs/blacklist-visitor.input';
import { PaginatedVisitorsResponse } from '../dto/responses/paginated-visitors.response';
import { PaginationInput }          from '../../shared/dto/inputs/pagination.input';
import { CustomError }              from '../../shared/utils/errors.utils';
import { AccessErrorCode, GeneralErrorCode } from '../../shared/constans/error-codes.constants';
import { JwtAccessPayload }         from '../../shared/interfaces/jwt-payload.interface';
import { VisitorIdentityType }      from '../enums/visitor-identity-type.enum';
import { NotificationsService }     from '../../notifications/services/notifications.service';
import { NotificationType }         from '../../notifications/enums/notification-type.enum';
import { NotificationPriority }     from '../../notifications/enums/notification-priority.enum';
import { ValidRoles }              from '../../roles/enums/valid-roles';

/**
 * Fusiona los datos del documento que llegan de portería con los que el
 * visitante ya tenía. Devuelve `null` cuando no hay nada nuevo que guardar, para
 * no escribir en la BD en cada visita de la misma persona.
 *
 * Se fusiona y no se reemplaza porque cada escaneo lee lo que alcanza a leer: si
 * uno saca seis campos y el siguiente sólo cuatro, reemplazar borraría los dos
 * que ya estaban bien guardados.
 */
const mergeVisitorMetadata = (
  current: Record<string, any> | undefined,
  incoming: Record<string, any> | undefined,
): Record<string, any> | null => {
  if (!incoming || Object.keys(incoming).length === 0) return null;
  const base = current ?? {};
  const merged = { ...base, ...incoming };
  return JSON.stringify(merged) === JSON.stringify(base) ? null : merged;
};

@Injectable()
export class VisitorsService {
  private readonly logger = new Logger(VisitorsService.name);

  constructor(
    @InjectRepository(Visitor)
    private readonly visitorRepo: Repository<Visitor>,
    private readonly notificationsService: NotificationsService,
  ) {}

  // ================================================================
  // BUSCAR O CREAR VISITANTE
  // Reutiliza el registro si la persona ya visitó el complejo antes.
  // ================================================================

  async findOrCreate(
    complexId: string,
    data: {
      name: string;
      lastName: string;
      identity: string;
      identityType?: VisitorIdentityType;
      phone?: string;
      photoUrl?: string;
      metadata?: Record<string, any>;
    },
  ): Promise<Visitor> {
    const identity = data.identity.trim().toUpperCase();

    // Buscar por identidad + tipo + complejo
    const existing = await this.visitorRepo.findOne({
      where: {
        complexId,
        identity,
        identityType: data.identityType ?? VisitorIdentityType.CC,
        deletedAt: IsNull(),
      },
    });

    if (existing) {
      let changed = false;

      // Actualizar foto si viene nueva
      if (data.photoUrl && data.photoUrl !== existing.photoUrl) {
        existing.photoUrl = data.photoUrl;
        changed = true;
      }

      const merged = mergeVisitorMetadata(existing.metadata, data.metadata);
      if (merged) {
        existing.metadata = merged;
        changed = true;
      }

      if (changed) await this.visitorRepo.save(existing);
      return existing;
    }

    const visitor = this.visitorRepo.create({
      complexId,
      name:         data.name,
      lastName:     data.lastName,
      identity,
      identityType: data.identityType ?? VisitorIdentityType.CC,
      phone:        data.phone,
      photoUrl:     data.photoUrl,
      metadata:     data.metadata,
      isBlacklisted: false,
    });

    return this.visitorRepo.save(visitor);
  }

  // ================================================================
  // VERIFICAR LISTA NEGRA
  // ================================================================

  async assertNotBlacklisted(visitor: Visitor): Promise<void> {
    if (visitor.isBlacklisted) {
      throw new CustomError({
        message: `El visitante "${visitor.fullName}" está en lista negra. Razón: ${visitor.blacklistReason}`,
        statusCode: HttpStatus.FORBIDDEN,
        errorCode: AccessErrorCode.VISITOR_BLACK_LISTED,
      });
    }
  }

  // ================================================================
  // BLOQUEAR VISITANTE
  // ================================================================

  async blacklist(
    input: BlacklistVisitorInput,
    currentUser: JwtAccessPayload,
  ): Promise<Visitor> {
    const visitor = await this.findById(input.visitorId);

    if (visitor.isBlacklisted) {
      throw new CustomError({
        message: 'El visitante ya está en lista negra',
        statusCode: HttpStatus.CONFLICT,
        errorCode: GeneralErrorCode.CONFLICT,
      });
    }

    visitor.isBlacklisted      = true;
    visitor.blacklistReason    = input.reason;
    visitor.blacklistedAt      = new Date();
    visitor.blacklistedByUserId = currentUser.sub;

    const saved = await this.visitorRepo.save(visitor);
    this.logger.warn(`Visitante bloqueado: ${visitor.id} — ${visitor.fullName} por ${currentUser.sub}`);

    // Avisar a los guardias del complejo para que no permitan el ingreso (fire & forget).
    this.notifyBlacklisted(saved, currentUser).catch(err =>
      this.logger.warn(`Error al notificar visitante en lista negra ${saved.id}: ${err?.message}`),
    );

    return saved;
  }

  /** Notifica a la seguridad del complejo que un visitante entró a lista negra. */
  private async notifyBlacklisted(
    visitor: Visitor,
    currentUser: JwtAccessPayload,
  ): Promise<void> {
    const userIds = (
      await this.notificationsService.findUserIdsByRoleInternal(
        visitor.complexId,
        [ValidRoles.SECURITY_ROL],
      )
    ).filter(id => id !== currentUser.sub);

    if (userIds.length === 0) return;

    await this.notificationsService.notify({
      complexId:       visitor.complexId,
      userIds,
      type:            NotificationType.VISITOR_BLACKLISTED,
      priority:        NotificationPriority.HIGH,
      title:           'Visitante en lista negra',
      body:            `${visitor.fullName} fue agregado a la lista negra. No permitir su ingreso.`,
      entityId:        visitor.id,
      entityType:      'visitor',
      createdByUserId: currentUser.entityType === 'user' ? currentUser.sub : undefined,
      metadata:        { visitorId: visitor.id, reason: visitor.blacklistReason },
    });
  }

  // ================================================================
  // DESBLOQUEAR VISITANTE
  // ================================================================

  async removeFromBlacklist(
    visitorId: string,
    currentUser: JwtAccessPayload,
  ): Promise<Visitor> {
    const visitor = await this.findById(visitorId);

    if (!visitor.isBlacklisted) {
      throw new CustomError({
        message: 'El visitante no está en lista negra',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: GeneralErrorCode.BAD_REQUEST,
      });
    }

    visitor.isBlacklisted       = false;
    visitor.blacklistReason     = null;
    visitor.blacklistedAt       = null;
    visitor.blacklistedByUserId = null;

    this.logger.log(`Visitante desbloqueado: ${visitor.id} por ${currentUser.sub}`);
    return this.visitorRepo.save(visitor);
  }

  // ================================================================
  // LISTAR VISITANTES DEL COMPLEJO
  // ================================================================

  async findByComplex(
    complexId: string,
    pagination: PaginationInput,
    search?: string,
    onlyBlacklisted?: boolean,
  ): Promise<PaginatedVisitorsResponse> {
    const { page, limit } = pagination;
    const skip = (page - 1) * limit;

    const qb = this.visitorRepo
      .createQueryBuilder('v')
      .where('v.complex_id = :complexId', { complexId })
      .andWhere('v.deleted_at IS NULL');

    if (onlyBlacklisted) qb.andWhere('v.is_blacklisted = true');

    if (search) {
      qb.andWhere(
        `(v.name ILIKE :s OR v.last_name ILIKE :s OR v.identity ILIKE :s OR v.phone ILIKE :s)`,
        { s: `%${search}%` },
      );
    }

    qb.orderBy('v.created_at', 'DESC').skip(skip).take(limit);

    const [items, totalItems] = await qb.getManyAndCount();
    const totalPages = Math.ceil(totalItems / limit);

    return {
      items,
      pagination: {
        currentPage:    page,
        itemsPerPage:   limit,
        totalItems,
        totalPages,
        hasNextPage:     page < totalPages,
        hasPreviousPage: page > 1,
      },
    };
  }

  // ================================================================
  // BUSCAR POR ID
  // ================================================================

  async findById(id: string): Promise<Visitor> {
    const visitor = await this.visitorRepo.findOne({
      where:     { id, deletedAt: IsNull() },
      relations: ['blacklistedByUser'],
    });

    if (!visitor) {
      throw new CustomError({
        message: `Visitante con ID "${id}" no encontrado`,
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: AccessErrorCode.VISITOR_NOT_FOUND,
      });
    }

    return visitor;
  }

  async updatePhotoUrl(visitorId: string, url: string): Promise<Visitor> {
    const visitor = await this.findById(visitorId);
    await this.visitorRepo.update(visitorId, { photoUrl: url });
    visitor.photoUrl = url;
    return visitor;
  }
}
