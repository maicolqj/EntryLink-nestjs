import { Resolver, Query, Mutation, Args, ID } from '@nestjs/graphql';

import { ComplexDocument } from '../entities/complex-document.entity';
import { ComplexContact } from '../entities/complex-contact.entity';
import { ComplexSchedule } from '../entities/complex-schedule.entity';
import {
  CreateComplexContactInput,
  CreateComplexDocumentInput,
  CreateComplexScheduleInput,
  UpdateComplexContactInput,
  UpdateComplexDocumentInput,
  UpdateComplexScheduleInput,
  UpdateComplexInfoSettingsInput,
} from '../dto/complex-info.inputs';
import {
  ComplexDocumentAckReport,
  ComplexInfoSettings,
  MyComplexDocument,
  MyComplexInfoResponse,
} from '../dto/complex-info.responses';
import { ComplexDocumentsService } from '../services/complex-documents.service';
import { ComplexContactsService } from '../services/complex-contacts.service';
import { ComplexSchedulesService } from '../services/complex-schedules.service';
import { MyComplexService } from '../services/my-complex.service';
import { COMPLEX_INFO_ADMIN_ROLES } from '../services/complex-info-access.service';
import { Auth } from '../../shared/decorators/auth.decorator';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { ValidRoles } from '../../roles/enums/valid-roles';

const ADMIN = COMPLEX_INFO_ADMIN_ROLES;
const RESIDENT = [ValidRoles.RESIDENT_ROL];

/**
 * "Mi Conjunto". Por rol, sin permisos nuevos: la cuenta del complejo (y el
 * SUPER_ADMIN) administra; el residente lee lo publicado para él.
 */
@Resolver()
export class ComplexInfoResolver {
  constructor(
    private readonly myComplexService: MyComplexService,
    private readonly documentsService: ComplexDocumentsService,
    private readonly contactsService: ComplexContactsService,
    private readonly schedulesService: ComplexSchedulesService,
  ) {}

  // ── Residente ─────────────────────────────────────────────────────

  @Query(() => MyComplexInfoResponse, {
    name: 'myComplexInfo',
    description:
      'Mi Conjunto: datos, contactos, horarios y documentos para el residente',
  })
  @Auth({ roles: RESIDENT })
  myComplexInfo(
    @Args('complexId') complexId: string,
    @CurrentUser() user: JwtAccessPayload,
  ): Promise<MyComplexInfoResponse> {
    return this.myComplexService.find(complexId, user);
  }

  @Query(() => MyComplexDocument, {
    name: 'myComplexDocument',
    description:
      'Un documento publicado, con su texto completo. Abrirlo cuenta como leído si pide acuse',
  })
  @Auth({ roles: RESIDENT })
  myComplexDocument(
    @Args('id', { type: () => ID }) id: string,
    @CurrentUser() user: JwtAccessPayload,
  ): Promise<MyComplexDocument> {
    return this.documentsService.getForResident(id, user);
  }

  @Mutation(() => MyComplexDocument, {
    name: 'acknowledgeComplexDocument',
    description:
      'El residente confirma que leyó la versión vigente. Ya no hace falta: abrir el documento lo registra (se mantiene para versiones viejas de la app)',
  })
  @Auth({ roles: RESIDENT })
  acknowledgeComplexDocument(
    @Args('id', { type: () => ID }) id: string,
    @CurrentUser() user: JwtAccessPayload,
  ): Promise<MyComplexDocument> {
    return this.documentsService.acknowledge(id, user);
  }

  // ── Administración: documentos ────────────────────────────────────

  @Query(() => [ComplexDocument], {
    name: 'complexDocuments',
    description: 'Todos los documentos del conjunto, incluidos los borradores',
  })
  @Auth({ roles: ADMIN })
  complexDocuments(
    @Args('complexId') complexId: string,
    @CurrentUser() user: JwtAccessPayload,
  ): Promise<ComplexDocument[]> {
    return this.documentsService.listAdmin(complexId, user);
  }

  @Mutation(() => ComplexDocument, { name: 'createComplexDocument' })
  @Auth({ roles: ADMIN })
  createComplexDocument(
    @Args('input') input: CreateComplexDocumentInput,
    @CurrentUser() user: JwtAccessPayload,
  ): Promise<ComplexDocument> {
    return this.documentsService.create(input, user);
  }

  @Mutation(() => ComplexDocument, { name: 'updateComplexDocument' })
  @Auth({ roles: ADMIN })
  updateComplexDocument(
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: UpdateComplexDocumentInput,
    @CurrentUser() user: JwtAccessPayload,
  ): Promise<ComplexDocument> {
    return this.documentsService.update(id, input, user);
  }

  @Mutation(() => Boolean, { name: 'deleteComplexDocument' })
  @Auth({ roles: ADMIN })
  deleteComplexDocument(
    @Args('id', { type: () => ID }) id: string,
    @CurrentUser() user: JwtAccessPayload,
  ): Promise<boolean> {
    return this.documentsService.remove(id, user);
  }

  @Query(() => ComplexDocumentAckReport, {
    name: 'complexDocumentAckReport',
    description: 'Qué unidades confirmaron la lectura de la versión vigente',
  })
  @Auth({ roles: ADMIN })
  complexDocumentAckReport(
    @Args('id', { type: () => ID }) id: string,
    @CurrentUser() user: JwtAccessPayload,
  ): Promise<ComplexDocumentAckReport> {
    return this.documentsService.ackReport(id, user);
  }

  // ── Administración: botones de acción rápida ──────────────────────

  @Query(() => ComplexInfoSettings, {
    name: 'complexInfoSettings',
    description: 'Qué botones muestra la app en Mi Conjunto',
  })
  @Auth({ roles: ADMIN })
  complexInfoSettings(
    @Args('complexId') complexId: string,
    @CurrentUser() user: JwtAccessPayload,
  ): Promise<ComplexInfoSettings> {
    return this.myComplexService.getSettings(complexId, user);
  }

  @Mutation(() => ComplexInfoSettings, { name: 'updateComplexInfoSettings' })
  @Auth({ roles: ADMIN })
  updateComplexInfoSettings(
    @Args('complexId') complexId: string,
    @Args('input') input: UpdateComplexInfoSettingsInput,
    @CurrentUser() user: JwtAccessPayload,
  ): Promise<ComplexInfoSettings> {
    return this.myComplexService.updateSettings(complexId, input, user);
  }

  // ── Administración: contactos ─────────────────────────────────────

  @Query(() => [ComplexContact], {
    name: 'complexContacts',
    description: 'Directorio de contactos, incluidos los ocultos',
  })
  @Auth({ roles: ADMIN })
  complexContacts(
    @Args('complexId') complexId: string,
    @CurrentUser() user: JwtAccessPayload,
  ): Promise<ComplexContact[]> {
    return this.contactsService.listAdmin(complexId, user);
  }

  @Mutation(() => ComplexContact, { name: 'createComplexContact' })
  @Auth({ roles: ADMIN })
  createComplexContact(
    @Args('input') input: CreateComplexContactInput,
    @CurrentUser() user: JwtAccessPayload,
  ): Promise<ComplexContact> {
    return this.contactsService.create(input, user);
  }

  @Mutation(() => ComplexContact, { name: 'updateComplexContact' })
  @Auth({ roles: ADMIN })
  updateComplexContact(
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: UpdateComplexContactInput,
    @CurrentUser() user: JwtAccessPayload,
  ): Promise<ComplexContact> {
    return this.contactsService.update(id, input, user);
  }

  @Mutation(() => Boolean, { name: 'deleteComplexContact' })
  @Auth({ roles: ADMIN })
  deleteComplexContact(
    @Args('id', { type: () => ID }) id: string,
    @CurrentUser() user: JwtAccessPayload,
  ): Promise<boolean> {
    return this.contactsService.remove(id, user);
  }

  // ── Administración: horarios ──────────────────────────────────────

  @Query(() => [ComplexSchedule], {
    name: 'complexSchedules',
    description: 'Horarios del conjunto, incluidos los ocultos',
  })
  @Auth({ roles: ADMIN })
  complexSchedules(
    @Args('complexId') complexId: string,
    @CurrentUser() user: JwtAccessPayload,
  ): Promise<ComplexSchedule[]> {
    return this.schedulesService.listAdmin(complexId, user);
  }

  @Mutation(() => ComplexSchedule, { name: 'createComplexSchedule' })
  @Auth({ roles: ADMIN })
  createComplexSchedule(
    @Args('input') input: CreateComplexScheduleInput,
    @CurrentUser() user: JwtAccessPayload,
  ): Promise<ComplexSchedule> {
    return this.schedulesService.create(input, user);
  }

  @Mutation(() => ComplexSchedule, { name: 'updateComplexSchedule' })
  @Auth({ roles: ADMIN })
  updateComplexSchedule(
    @Args('id', { type: () => ID }) id: string,
    @Args('input') input: UpdateComplexScheduleInput,
    @CurrentUser() user: JwtAccessPayload,
  ): Promise<ComplexSchedule> {
    return this.schedulesService.update(id, input, user);
  }

  @Mutation(() => Boolean, { name: 'deleteComplexSchedule' })
  @Auth({ roles: ADMIN })
  deleteComplexSchedule(
    @Args('id', { type: () => ID }) id: string,
    @CurrentUser() user: JwtAccessPayload,
  ): Promise<boolean> {
    return this.schedulesService.remove(id, user);
  }
}
