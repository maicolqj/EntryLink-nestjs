import { Args, ID, Mutation, Query, Resolver } from '@nestjs/graphql';

import { PlatformAnnouncementsService } from '../services/platform-announcements.service';
import { PlatformAnnouncement } from '../entities/platform-announcement.entity';
import {
  AnnouncementTargetInput,
  PlatformAnnouncementFilterInput,
} from '../dto/platform-announcement.inputs';
import {
  AnnouncementBulkResult,
  AnnouncementFolderCounts,
  AnnouncementRecipientComplex,
  AnnouncementTargetPreview,
  PlatformAnnouncementPaginatedResult,
} from '../dto/platform-announcement.responses';
import { Auth } from '../../shared/decorators/auth.decorator';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { ValidRoles } from '../../roles/enums/valid-roles';
import { PaginationInput } from '../../shared/dto/inputs/pagination.input';

const PLATFORM_STAFF = [
  ValidRoles.SUPER_ADMIN_ROL,
  ValidRoles.COMPILANCE_OFFICER_ROL,
];

/**
 * Lectura de los comunicados de la plataforma. El envío va por
 * `POST /platform-announcements` porque lleva imágenes.
 */
@Resolver(() => PlatformAnnouncement)
export class PlatformAnnouncementsResolver {
  constructor(
    private readonly announcementsService: PlatformAnnouncementsService,
  ) {}

  @Query(() => PlatformAnnouncementPaginatedResult, {
    name: 'platformAnnouncements',
    description: 'Historial de comunicados enviados a los conjuntos',
  })
  @Auth({ roles: PLATFORM_STAFF })
  platformAnnouncements(
    @CurrentUser() user: JwtAccessPayload,
    @Args('pagination', { nullable: true })
    pagination: PaginationInput = { page: 1, limit: 20 },
    @Args('filter', { nullable: true })
    filter?: PlatformAnnouncementFilterInput,
  ): Promise<PlatformAnnouncementPaginatedResult> {
    return this.announcementsService.findAll(pagination, user.sub, filter);
  }

  @Query(() => AnnouncementFolderCounts, {
    name: 'platformAnnouncementFolderCounts',
    description: 'Cuántos comunicados hay en cada carpeta para quien consulta',
  })
  @Auth({ roles: PLATFORM_STAFF })
  platformAnnouncementFolderCounts(
    @CurrentUser() user: JwtAccessPayload,
  ): Promise<AnnouncementFolderCounts> {
    return this.announcementsService.folderCounts(user.sub);
  }

  @Mutation(() => AnnouncementBulkResult, {
    name: 'starPlatformAnnouncements',
    description: 'Destaca o quita el destacado (solo para quien lo hace)',
  })
  @Auth({ roles: PLATFORM_STAFF })
  starPlatformAnnouncements(
    @CurrentUser() user: JwtAccessPayload,
    @Args('ids', { type: () => [ID] }) ids: string[],
    @Args('starred') starred: boolean,
  ): Promise<AnnouncementBulkResult> {
    return this.announcementsService.setStarred(
      validIds(ids),
      user.sub,
      starred,
    );
  }

  @Mutation(() => AnnouncementBulkResult, {
    name: 'archivePlatformAnnouncements',
    description: 'Archiva o devuelve a Enviados (solo para quien lo hace)',
  })
  @Auth({ roles: PLATFORM_STAFF })
  archivePlatformAnnouncements(
    @CurrentUser() user: JwtAccessPayload,
    @Args('ids', { type: () => [ID] }) ids: string[],
    @Args('archived') archived: boolean,
  ): Promise<AnnouncementBulkResult> {
    return this.announcementsService.setArchived(
      validIds(ids),
      user.sub,
      archived,
    );
  }

  @Mutation(() => AnnouncementBulkResult, {
    name: 'trashPlatformAnnouncements',
    description:
      'Manda a la papelera y retira los avisos de las bandejas de los conjuntos',
  })
  @Auth({ roles: PLATFORM_STAFF })
  trashPlatformAnnouncements(
    @CurrentUser() user: JwtAccessPayload,
    @Args('ids', { type: () => [ID] }) ids: string[],
  ): Promise<AnnouncementBulkResult> {
    return this.announcementsService.moveToTrash(validIds(ids), user);
  }

  @Mutation(() => AnnouncementBulkResult, {
    name: 'restorePlatformAnnouncements',
    description: 'Saca de la papelera (los avisos retirados no vuelven)',
  })
  @Auth({ roles: PLATFORM_STAFF })
  restorePlatformAnnouncements(
    @Args('ids', { type: () => [ID] }) ids: string[],
  ): Promise<AnnouncementBulkResult> {
    return this.announcementsService.restoreFromTrash(validIds(ids));
  }

  @Mutation(() => AnnouncementBulkResult, {
    name: 'purgePlatformAnnouncements',
    description: 'Elimina para siempre lo que está en la papelera',
  })
  @Auth({ roles: PLATFORM_STAFF })
  purgePlatformAnnouncements(
    @Args('ids', { type: () => [ID] }) ids: string[],
  ): Promise<AnnouncementBulkResult> {
    return this.announcementsService.purgeFromTrash(validIds(ids));
  }

  @Query(() => AnnouncementTargetPreview, {
    name: 'platformAnnouncementTargetPreview',
    description: 'Conjuntos que recibirían el comunicado con estos filtros',
  })
  @Auth({ roles: PLATFORM_STAFF })
  platformAnnouncementTargetPreview(
    @Args('target') target: AnnouncementTargetInput,
  ): Promise<AnnouncementTargetPreview> {
    return this.announcementsService.previewTarget(target);
  }

  @Query(() => [AnnouncementRecipientComplex], {
    name: 'platformAnnouncementRecipients',
    description:
      'Conjuntos que recibieron el comunicado, con avisos creados y leídos',
  })
  @Auth({ roles: PLATFORM_STAFF })
  platformAnnouncementRecipients(
    @Args('id', { type: () => ID }) id: string,
  ): Promise<AnnouncementRecipientComplex[]> {
    return this.announcementsService.findRecipients(id);
  }
}

/** Hasta una página grande de la bandeja; ids que no son UUID se descartan. */
const MAX_BULK_IDS = 100;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validIds(ids: string[]): string[] {
  return ids.filter((id) => UUID_RE.test(id)).slice(0, MAX_BULK_IDS);
}
