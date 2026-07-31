import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';

import { AuthResolver } from './auth.resolver';
import { ResidentDeviceResolver } from './resident-device.resolver';
import { WhatsAppLoginResolver } from './whatsapp-login.resolver';
import { SupervisorsController } from './controllers/supervisors.controller';
import { WhatsAppWebhookController } from './controllers/whatsapp-webhook.controller';
import { AuthService } from './services/auth.service';
import { TokenService } from './services/token.service';
import { SessionService } from './services/session.service';
import { OtpService } from './services/otp.service';
import { ResidentDeviceService } from './services/resident-device.service';
import { WhatsAppService } from './services/whatsapp.service';
import { WhatsAppWebhookService } from './services/whatsapp-webhook.service';
import { WhatsAppLoginService } from './services/whatsapp-login.service';

import { JwtAccessStrategy } from './strategies/jwt-access.strategy';
import { JwtRefreshStrategy } from './strategies/jwt-refresh.strategy';

import { OtpProducer } from './queues/otp.producer';
import { OtpProcessor } from './queues/otp.processor';
import { OTP_QUEUE_NAME } from './queues/otp.queue.constants';

import { OtpCode } from './entities/otp-code.entity';
import { RefreshToken } from './entities/refresh-token.entity';
import { ResidentDevice } from './entities/resident-device.entity';
import { WhatsAppLoginChallenge } from './entities/whatsapp-login-challenge.entity';
import { UserSession } from './entities/user-session.entity';
import { User } from '../users/entities/user.entity';
import { ResidentialComplex } from '../residential-complex/entities/residential-complex.entity';
import { Role } from '../roles/entities/role.entity';
import { UserRole } from '../users/entities/user_has_roles.entity';


// CacheService se asume provisto por SharedModule o importado directamente
import { CacheModule } from '../../core/infrastructure/cache/cache.module';

@Module({
  controllers: [SupervisorsController, WhatsAppWebhookController],
  imports: [
    ConfigModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({}), // Configurado sin secret fijo; cada llamada usa su propio secret
    TypeOrmModule.forFeature([User, ResidentialComplex, OtpCode, RefreshToken, ResidentDevice, WhatsAppLoginChallenge, UserSession, Role, UserRole]),
    BullModule.registerQueue({ name: OTP_QUEUE_NAME }),
    HttpModule,
    CacheModule,
  ],
  providers: [
    // Resolvers
    AuthResolver,
    ResidentDeviceResolver,
    WhatsAppLoginResolver,

    // Services
    AuthService,
    TokenService,
    SessionService,
    OtpService,
    ResidentDeviceService,
    WhatsAppService,
    WhatsAppWebhookService,
    WhatsAppLoginService,

    // Strategies (Passport)
    JwtAccessStrategy,
    JwtRefreshStrategy,

    // Queue
    OtpProducer,
    OtpProcessor,
  ],
  exports: [AuthService, TokenService, SessionService, JwtModule, PassportModule],
})
export class AuthModule {}
