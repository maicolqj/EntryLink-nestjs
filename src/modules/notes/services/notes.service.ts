import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { Note } from '../entities/note.entity';
import { FilterNotesInput } from '../dto/inputs/filter-notes.input';
import { PaginatedNotesResponse } from '../dto/responses/paginated-notes.response';

import { PaginationInput } from '../../shared/dto/inputs/pagination.input';
import { CustomError } from '../../shared/utils/errors.utils';
import { NoteErrorCode } from '../../shared/constans/error-codes.constants';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { ValidRoles } from '../../roles/enums/valid-roles';
import { ResidentialComplexService } from '../../residential-complex/services/residential-complex.service';
import { AuditService }    from '../../audit/services/audit.service';
import { AuditAction }     from '../../audit/enums/audit-action.enum';
import { AuditEntityType } from '../../audit/enums/audit-entity-type.enum';

interface CreateNoteData {
  complexId: string;
  title: string;
  content: string;
  imageUrls: string[];
  createdByRole: string | null;
  supervisorVisitId?: string;
}

@Injectable()
export class NotesService {
  private readonly logger = new Logger(NotesService.name);

  constructor(
    @InjectRepository(Note)
    private readonly noteRepo: Repository<Note>,
    private readonly complexService: ResidentialComplexService,
    private readonly auditService:   AuditService,
  ) { }

  // ================================================================
  // CREAR NOTA
  // Las imágenes ya fueron subidas a R2 por el controller.
  // Si el save falla, el controller se encarga del rollback en R2.
  // ================================================================

  async createNote(
    data: CreateNoteData,
    currentUser: JwtAccessPayload,
  ): Promise<Note> {
    const isSupervisor = currentUser.roles?.includes(ValidRoles.SUPERVISOR_ROL) ?? false;

    if (!this.isSuperAdmin(currentUser) && !isSupervisor) {
      await this.complexService.assertComplexAccess(data.complexId, currentUser);
    }

    const note = this.noteRepo.create({
      title:             data.title.trim(),
      content:           data.content.trim(),
      imageUrls:         data.imageUrls,
      complexId:         data.complexId,
      createdByUserId:   currentUser.entityType === 'user' ? currentUser.sub : null,
      createdByRole:     data.createdByRole,
      supervisorVisitId: data.supervisorVisitId,
    });

    const saved = await this.noteRepo.save(note);
    this.logger.log(
      `Nota creada: ${saved.id} | usuario: ${currentUser.sub} | complejo: ${data.complexId} | imágenes: ${data.imageUrls.length}`,
    );

    void this.auditService.log({
      entityType:      AuditEntityType.Note,
      entityId:        saved.id,
      action:          AuditAction.CREATE,
      newValue:        { id: saved.id, title: saved.title, complexId: saved.complexId },
      performedById:   currentUser.sub,
      performedByName: currentUser.email,
      performedByRole: data.createdByRole ?? currentUser.roles?.[0] ?? '',
      complexId:       data.complexId,
      description:     `Nota creada: "${saved.title}"`,
    });

    return this.loadRelations(saved.id);
  }

  // ================================================================
  // LISTAR NOTAS DEL COMPLEJO (paginado + filtros)
  // ================================================================

  async findNotesByComplex(
    complexId: string,
    pagination: PaginationInput,
    filters: FilterNotesInput,
    currentUser: JwtAccessPayload,
  ): Promise<PaginatedNotesResponse> {
    if (!this.isSuperAdmin(currentUser)) {
      await this.complexService.assertComplexAccess(complexId, currentUser);
    }

    const { page, limit } = pagination;
    const skip = (page - 1) * limit;

    const qb = this.noteRepo
      .createQueryBuilder('n')
      .leftJoinAndSelect('n.createdByUser', 'author')
      .where('n.complexId = :complexId', { complexId })
      .andWhere('n.deletedAt IS NULL');

    // Visibilidad por rol: restringe qué created_by_role puede ver cada usuario
    if (!this.isSuperAdmin(currentUser)) {
      const visibleRoles = this.isComplexAdmin(currentUser)
        ? [ValidRoles.COMPLEX_ROL, ValidRoles.SUPERVISOR_ROL, ValidRoles.SECURITY_ROL]
        : [ValidRoles.SUPERVISOR_ROL, ValidRoles.SECURITY_ROL];
      qb.andWhere('n.created_by_role IN (:...visibleRoles)', { visibleRoles });
    }

    // Filtro opcional por uno o varios roles (dentro de los roles visibles)
    if (filters?.createdByRoles?.length) {
      qb.andWhere('n.created_by_role IN (:...filterRoles)', { filterRoles: filters.createdByRoles });
    }

    // createdByUserId: solo SUPER_ADMIN y COMPLEX_ROL pueden filtrar por usuario
    if (filters?.createdByUserId && !this.isSecurityOrSupervisor(currentUser)) {
      qb.andWhere('n.created_by_user_id = :filterUserId', {
        filterUserId: filters.createdByUserId,
      });
    }
    if (filters?.dateFrom) {
      qb.andWhere('n.createdAt >= :dateFrom', { dateFrom: new Date(filters.dateFrom) });
    }
    if (filters?.dateTo) {
      qb.andWhere('n.createdAt <= :dateTo', { dateTo: new Date(filters.dateTo) });
    }

    qb.orderBy('n.createdAt', 'DESC').skip(skip).take(limit);

    const [items, totalItems] = await qb.getManyAndCount();
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
  // DETALLE POR ID
  // ================================================================

  async findById(id: string, currentUser: JwtAccessPayload): Promise<Note> {
    const note = await this.noteRepo.findOne({
      where: { id },
      relations: ['createdByUser', 'complex'],
    });

    if (!note) {
      throw new CustomError({
        message: `Nota con ID "${id}" no encontrada`,
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: NoteErrorCode.NOTE_NOT_FOUND,
      });
    }

    if (this.isSuperAdmin(currentUser)) return note;

    await this.complexService.assertComplexAccess(note.complexId, currentUser);

    const visibleRoles = this.isComplexAdmin(currentUser)
      ? [ValidRoles.COMPLEX_ROL, ValidRoles.SUPERVISOR_ROL, ValidRoles.SECURITY_ROL]
      : [ValidRoles.SUPERVISOR_ROL, ValidRoles.SECURITY_ROL];

    if (note.createdByRole && !visibleRoles.includes(note.createdByRole as ValidRoles)) {
      throw new CustomError({
        message: 'No tienes permiso para ver esta nota',
        statusCode: HttpStatus.FORBIDDEN,
        errorCode: NoteErrorCode.NOTE_ACCESS_DENIED,
      });
    }

    return note;
  }

  // ================================================================
  // ELIMINAR NOTA — soft delete (solo SUPER_ADMIN, validado en resolver)
  // ================================================================

  async deleteNote(id: string, currentUser: JwtAccessPayload): Promise<Note> {
    const note = await this.noteRepo.findOne({ where: { id } });

    if (!note) {
      throw new CustomError({
        message: `Nota con ID "${id}" no encontrada`,
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: NoteErrorCode.NOTE_NOT_FOUND,
      });
    }

    if (note.deletedAt) {
      throw new CustomError({
        message: 'La nota ya fue eliminada anteriormente',
        statusCode: HttpStatus.CONFLICT,
        errorCode: NoteErrorCode.NOTE_ALREADY_DELETED,
      });
    }

    await this.noteRepo.softDelete(id);
    this.logger.warn(`Nota eliminada (soft): ${id} por SUPER_ADMIN ${currentUser.sub}`);

    void this.auditService.log({
      entityType:      AuditEntityType.Note,
      entityId:        id,
      action:          AuditAction.DELETE,
      previousValue:   { id: note.id, title: note.title, complexId: note.complexId, deletedAt: null },
      newValue:        { deletedAt: new Date() },
      performedById:   currentUser.sub,
      performedByName: currentUser.email,
      performedByRole: currentUser.roles?.[0] ?? '',
      complexId:       note.complexId,
      description:     `Nota eliminada (soft-delete): "${note.title}"`,
    });

    return { ...note, deletedAt: new Date() };
  }

  // ================================================================
  // HELPERS PRIVADOS
  // ================================================================

  private isSuperAdmin(user: JwtAccessPayload): boolean {
    return user.roles?.includes(ValidRoles.SUPER_ADMIN_ROL) ?? false;
  }

  private isComplexAdmin(user: JwtAccessPayload): boolean {
    return user.roles?.includes(ValidRoles.COMPLEX_ROL) ?? false;
  }

  private isSecurityOrSupervisor(user: JwtAccessPayload): boolean {
    return (
      (user.roles?.includes(ValidRoles.SECURITY_ROL) ||
        user.roles?.includes(ValidRoles.SUPERVISOR_ROL)) ?? false
    );
  }

  private async loadRelations(id: string): Promise<Note> {
    return this.noteRepo.findOne({
      where: { id },
      relations: ['createdByUser', 'complex'],
    });
  }
}
