import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ManifestService } from './manifest.service';
import { ManifestController } from './manifest.controller';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [ManifestService],
  controllers: [ManifestController],
  exports: [ManifestService],
})
export class ManifestModule {}
