import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AppVersionPolicy } from './entities/app-version-policy.entity';
import { AppVersionsService } from './services/app-versions.service';
import { AppVersionsResolver } from './resolvers/app-versions.resolver';

/**
 * Actualización obligatoria de las apps (RemoteLink y EntryLink) para los
 * cambios que rompen compatibilidad. Las actualizaciones normales las ofrece
 * Google Play dentro de la app; esto solo fija el piso.
 */
@Module({
  imports: [TypeOrmModule.forFeature([AppVersionPolicy])],
  providers: [AppVersionsService, AppVersionsResolver],
})
export class AppVersionsModule {}
