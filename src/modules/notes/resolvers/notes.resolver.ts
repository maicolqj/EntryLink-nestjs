import { Resolver, Query, Mutation, Args } from '@nestjs/graphql';

import { Note }                   from '../entities/note.entity';
import { NotesService }           from '../services/notes.service';
import { FilterNotesInput }       from '../dto/inputs/filter-notes.input';
import { PaginatedNotesResponse } from '../dto/responses/paginated-notes.response';
import { PaginationInput }        from '../../shared/dto/inputs/pagination.input';

import { Auth }             from '../../shared/decorators/auth.decorator';
import { CurrentUser }      from '../../shared/decorators/current-user.decorator';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { ValidRoles }       from '../../roles/enums/valid-roles';
import { ValidPermissions } from '../../permissions/enums/valid-permissions';
import { Logger } from '@nestjs/common';

@Resolver(() => Note)
export class NotesResolver {
  private readonly logger: Logger = new Logger(NotesResolver.name);

  constructor(private readonly notesService: NotesService) {}

  // ================================================================
  // MUTATIONS
  // ================================================================

  /**
   * Elimina (soft delete) una nota. Exclusivo del SUPER_ADMIN_ROL.
   * La creación de notas se realiza via REST: POST /api/v1/notes
   */
  @Mutation(() => Note, { name: 'deleteNote' })
  @Auth({ roles: [ValidRoles.SUPER_ADMIN_ROL] })
  deleteNote(
    @Args('id') id: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<Note> {
    return this.notesService.deleteNote(id, currentUser);
  }

  // ================================================================
  // QUERIES
  // ================================================================

  /**
   * Lista paginada de notas del complejo, con filtros opcionales.
   * - SUPER_ADMIN:          todas las notas del complejo indicado.
   * - COMPLEX_ROL:          todas las notas de su complejo.
   * - SECURITY/SUPERVISOR:  solo sus propias notas en su complejo.
   */
  @Query(() => PaginatedNotesResponse, { name: 'findnotes' })
  @Auth({
    roles:       [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL, ValidRoles.SECURITY_ROL, ValidRoles.SUPERVISOR_ROL],
    permissions: [ValidPermissions.VIEW_NOTES],
  })
  findNotesByComplex(
    @Args('complexId') complexId: string,
    @Args('pagination', { nullable: true }) pagination: PaginationInput = { page: 1, limit: 20 },
    @Args('filters',    { nullable: true }) filters: FilterNotesInput = {},
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<PaginatedNotesResponse> {
    this.logger.warn(`DATOS RECIBIDOS EN EL CONTROLADOR complexId: ${complexId} `)
    return this.notesService.findNotesByComplex(complexId, pagination, filters, currentUser);
  }

  /**
   * Detalle de una nota por ID.
   * Aplica las mismas reglas de visibilidad que la query `notes`.
   */
  @Query(() => Note, { name: 'note' })
  @Auth({
    roles:       [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL, ValidRoles.SECURITY_ROL, ValidRoles.SUPERVISOR_ROL],
    permissions: [ValidPermissions.VIEW_NOTES],
  })
  findOne(
    @Args('id') id: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<Note> {
    return this.notesService.findById(id, currentUser);
  }
}
