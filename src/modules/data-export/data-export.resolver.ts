import { Args, Query, Resolver } from '@nestjs/graphql';

import { DataExportService } from './data-export.service';
import { DataExportModuleInfo } from './dto/data-export-module-info.response';
import { DataExportHistoryEntry } from './dto/data-export-history-entry.response';
import { Auth } from '../shared/decorators/auth.decorator';
import { CurrentUser } from '../shared/decorators/current-user.decorator';
import { JwtAccessPayload } from '../shared/interfaces/jwt-payload.interface';
import { ValidRoles } from '../roles/enums/valid-roles';

/**
 * Lo que la pantalla de respaldo necesita para pintarse. Los archivos no
 * viajan por GraphQL: se descargan por REST (DataExportController).
 */
@Resolver()
export class DataExportResolver {
  constructor(private readonly dataExportService: DataExportService) {}

  @Query(() => [DataExportModuleInfo], {
    name: 'dataExportModules',
    description: 'Módulos cuyos datos se pueden descargar en el complejo',
  })
  @Auth({ roles: [ValidRoles.COMPLEX_ROL, ValidRoles.SUPER_ADMIN_ROL] })
  dataExportModules(
    @Args('complexId') complexId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<DataExportModuleInfo[]> {
    return this.dataExportService.availableModules(complexId, currentUser);
  }

  @Query(() => [DataExportHistoryEntry], {
    name: 'dataExportHistory',
    description: 'Últimas 20 descargas de datos del complejo',
  })
  @Auth({ roles: [ValidRoles.COMPLEX_ROL, ValidRoles.SUPER_ADMIN_ROL] })
  dataExportHistory(
    @Args('complexId') complexId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<DataExportHistoryEntry[]> {
    return this.dataExportService.history(complexId, currentUser);
  }
}
