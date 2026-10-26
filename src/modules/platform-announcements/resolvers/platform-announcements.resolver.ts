import { Args, Query, Resolver } from '@nestjs/graphql';

import { PlatformAnnouncementsService } from '../services/platform-announcements.service';
import { PlatformAnnouncement } from '../entities/platform-announcement.entity';
import { AnnouncementTargetInput } from '../dto/platform-announcement.inputs';
import {
  AnnouncementTargetPreview,
  PlatformAnnouncementPaginatedResult,
} from '../dto/platform-announcement.responses';
import { Auth } from '../../shared/decorators/auth.decorator';
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
    @Args('pagination', { nullable: true })
    pagination: PaginationInput = { page: 1, limit: 20 },
  ): Promise<PlatformAnnouncementPaginatedResult> {
    return this.announcementsService.findAll(pagination);
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
}
