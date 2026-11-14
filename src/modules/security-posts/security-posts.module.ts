import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { SecurityPost } from './entities/security-post.entity';
import { SecurityPostGuard } from './entities/security-post-guard.entity';
import { SecurityPostsService } from './services/security-posts.service';
import { SecurityPostsResolver } from './resolvers/security-posts.resolver';
import { Resident } from '../residents/entities/resident.entity';
import { ResidentialComplexModule } from '../residential-complex/residential-complex.module';

/**
 * Porterías del conjunto. El enrutamiento (a qué vigilantes llega algo
 * dirigido a una portería) vive en `security-post-routing.ts` para que
 * notificaciones y citofonía lo usen sin importar este módulo.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([SecurityPost, SecurityPostGuard, Resident]),
    ResidentialComplexModule,
  ],
  providers: [SecurityPostsService, SecurityPostsResolver],
  exports: [SecurityPostsService],
})
export class SecurityPostsModule {}
