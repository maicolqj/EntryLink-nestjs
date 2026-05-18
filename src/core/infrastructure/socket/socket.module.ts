import { Global, Module } from '@nestjs/common';
import { SocketGateway } from './socket.gateway';
import { SocketService } from './socket.service';
import { AuthModule } from '../../../modules/auth/auth.module';
import { ResidentialComplexModule } from '../../../modules/residential-complex/residential-complex.module';

@Global()
@Module({
  imports: [AuthModule, ResidentialComplexModule],
  providers: [SocketGateway, SocketService],
  exports: [SocketService],
})
export class SocketModule {}
