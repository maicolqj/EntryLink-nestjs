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

interface CreateNoteData {
  complexId: string;
  title: string;
  content: string;
  imageUrls: string[];
}

@Injectable()
export class NotesService {
  private readonly logger = new Logger(NotesService.name);

  constructor(
    @InjectRepository(Note)
    private readonly noteRepo: Repository<Note>,
    private readonly complexService: ResidentialComplexService,
  ) { }

  // ================================================================
  // CREAR NOTA
  // Las imágenes ya fueron subidas a Cloudinary por el controller.
  // Si el save falla, el controller se encarga del rollback en Cloudinary.
  // ================================================================

  async createNote(
    data: CreateNoteData,
    currentUser: JwtAccessPayload,
  ): Promise<Note> {
    if (!this.isSuperAdmin(currentUser)) {
      await this.complexService.assertComplexAccess(data.complexId, currentUser);
    }

    const note = this.noteRepo.create({
      title: data.title.trim(),
      content: data.content.trim(),
      imageUrls: data.imageUrls,
      complexId: data.complexId,
      createdByUserId: currentUser.sub,
    });

    const saved = await this.noteRepo.save(note);
    this.logger.log(
      `Nota creada: ${saved.id} | usuario: ${currentUser.sub} | complejo: ${data.complexId} | imágenes: ${data.imageUrls.length}`,
    );

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
      const resp = await this.complexService.assertComplexAccess(complexId, currentUser);
      this.logger.warn(`COMPLEX ECONTRADO en findNotesByComplex ${JSON.stringify(resp, null, 5)} `)

    }

    const { page, limit } = pagination;
    const skip = (page - 1) * limit;

    const qb = this.noteRepo
      .createQueryBuilder('n')
      .leftJoinAndSelect('n.createdByUser', 'author')
      .leftJoinAndSelect('n.complex', 'complex')
      .where('n.complex_id = :complexId', { complexId })
      // .andWhere('n.deletedAt IS NULL');

    // SECURITY y SUPERVISOR: solo sus propias notas
    // if (this.isLimitedToOwnNotes(currentUser)) {
    //   qb.andWhere('n.created_by_user_id = :userId', { userId: currentUser.sub });
    // }

    // // Filtros opcionales (ignorados si el rol está limitado a sus propias notas)
    // if (filters?.createdByUserId && !this.isLimitedToOwnNotes(currentUser)) {
    //   qb.andWhere('n.created_by_user_id = :filterUserId', { filterUserId: filters.createdByUserId });
    // }
    // if (filters?.dateFrom) {
    //   qb.andWhere('n.created_at >= :dateFrom', { dateFrom: new Date(filters.dateFrom) });
    // }
    // if (filters?.dateTo) {
    //   qb.andWhere('n.created_at <= :dateTo', { dateTo: new Date(filters.dateTo) });
    // }

    qb.orderBy('n.createdAt', 'DESC').skip(skip).take(limit);

    const [items, totalItems] = await qb.getManyAndCount();
    const totalPages = Math.ceil(totalItems / limit);

    return {
      items,
      pagination: {
        currentPage: page,
        itemsPerPage: limit,
        totalItems,
        totalPages,
        hasNextPage: page < totalPages,
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

    if (this.isLimitedToOwnNotes(currentUser) && note.createdByUserId !== currentUser.sub) {
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

  private isLimitedToOwnNotes(user: JwtAccessPayload): boolean {
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
