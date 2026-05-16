import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { SentMessage }                    from '../entities/sent-message.entity';
import { SaveSentMessageInput }           from '../dto/inputs/save-sent-message.input';
import { PaginatedSentMessagesResponse }  from '../dto/responses/paginated-sent-messages.response';

import { PaginationInput }        from '../../shared/dto/inputs/pagination.input';
import { CustomError }            from '../../shared/utils/errors.utils';
import { MessageErrorCode }       from '../../shared/constans/error-codes.constants';
import { JwtAccessPayload }       from '../../shared/interfaces/jwt-payload.interface';
import { ValidRoles }             from '../../roles/enums/valid-roles';
import { ResidentialComplexService } from '../../residential-complex/services/residential-complex.service';
import { AuditService }           from '../../audit/services/audit.service';
import { AuditAction }            from '../../audit/enums/audit-action.enum';
import { AuditEntityType }        from '../../audit/enums/audit-entity-type.enum';

@Injectable()
export class MessagesService {
  private readonly logger = new Logger(MessagesService.name);

  constructor(
    @InjectRepository(SentMessage)
    private readonly sentMessageRepo: Repository<SentMessage>,
    private readonly complexService:  ResidentialComplexService,
    private readonly auditService:    AuditService,
  ) {}

  // ================================================================
  // GUARDAR MENSAJE ENVIADO
  // sentByUserId se extrae del JWT, no viene en el input
  // ================================================================

  async saveSentMessage(
    input: SaveSentMessageInput,
    currentUser: JwtAccessPayload,
  ): Promise<SentMessage> {
    if (!this.isSuperAdmin(currentUser)) {
      await this.complexService.assertComplexAccess(input.complexId, currentUser);
    }

    const message = this.sentMessageRepo.create({
      complexId:       input.complexId,
      sentByUserId:    currentUser.sub,
      unitId:          input.unitId,
      unitNumber:      input.unitNumber,
      channel:         input.channel,
      messageType:     input.messageType,
      body:            input.body.trim(),
      recipientCount:  input.recipientCount,
      recipientPhones: input.recipientPhones,
      sentAt:          new Date(),
    });

    const saved = await this.sentMessageRepo.save(message);
    this.logger.log(
      `Mensaje guardado: ${saved.id} | canal: ${saved.channel} | complejo: ${saved.complexId} | destinatarios: ${saved.recipientCount}`,
    );

    void this.auditService.log({
      entityType:      AuditEntityType.SentMessage,
      entityId:        saved.id,
      action:          AuditAction.CREATE,
      newValue:        { id: saved.id, channel: saved.channel, messageType: saved.messageType, complexId: saved.complexId },
      performedById:   currentUser.sub,
      performedByName: currentUser.email,
      performedByRole: currentUser.roles?.[0] ?? '',
      complexId:       saved.complexId,
      description:     `Mensaje enviado vía ${saved.channel} a ${saved.recipientCount} destinatario(s) — unidad ${saved.unitNumber}`,
    });

    return this.loadRelations(saved.id);
  }

  // ================================================================
  // LISTAR MENSAJES ENVIADOS DEL COMPLEJO (paginado, DESC sentAt)
  // ================================================================

  async findSentMessages(
    complexId: string,
    pagination: PaginationInput,
    currentUser: JwtAccessPayload,
  ): Promise<PaginatedSentMessagesResponse> {
    if (!this.isSuperAdmin(currentUser)) {
      await this.complexService.assertComplexAccess(complexId, currentUser);
    }

    const { page, limit } = pagination;
    const skip = (page - 1) * limit;

    const [items, totalItems] = await this.sentMessageRepo
      .createQueryBuilder('m')
      .leftJoinAndSelect('m.sentBy', 'sentBy')
      .where('m.complexId = :complexId', { complexId })
      .orderBy('m.sentAt', 'DESC')
      .skip(skip)
      .take(limit)
      .getManyAndCount();

    const totalPages = Math.ceil(totalItems / limit);

    return {
      items,
      pagination: {
        currentPage:     page,
        itemsPerPage:    limit,
        totalItems,
        totalPages,
        hasNextPage:     page < totalPages,
        hasPreviousPage: page > 1,
      },
    };
  }

  // ================================================================
  // HELPERS PRIVADOS
  // ================================================================

  private isSuperAdmin(user: JwtAccessPayload): boolean {
    return user.roles?.includes(ValidRoles.SUPER_ADMIN_ROL) ?? false;
  }

  private async loadRelations(id: string): Promise<SentMessage> {
    const msg = await this.sentMessageRepo.findOne({
      where: { id },
      relations: ['sentBy'],
    });

    if (!msg) {
      throw new CustomError({
        message: `Mensaje con ID "${id}" no encontrado`,
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: MessageErrorCode.MESSAGE_NOT_FOUND,
      });
    }

    return msg;
  }
}
