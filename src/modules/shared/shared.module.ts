import { Module } from '@nestjs/common';
import { QueryComplexityPlugin } from './plugins/query-complexity.plugin';

@Module({
  providers: [QueryComplexityPlugin],
})
export class SharedModule {}
