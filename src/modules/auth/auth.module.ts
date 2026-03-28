import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';

import { AuthResolver } from './auth.resolver';
import { AuthService } from './services/auth.service';
import { TokenService } from './services/token.service';
import { SessionService } from './services/session.service';
import { OtpService } from './services/otp.service';

import { JwtAccessStrategy } from './strategies/jwt-access.strategy';
import { JwtRefreshStrategy } from './strategies/jwt-refresh.strategy';

import { OtpProducer } from './queues/otp.producer';
import { OtpProcessor } from './queues/otp.processor';
import { OTP_QUEUE_NAME } from './queues/otp.queue.constants';

import { OtpCode } from './entities/otp-code.entity';
import { RefreshToken } from './entities/refresh-token.entity';
import { UserSession } from './entities/user-session.entity';
import { User } from '../users/entities/user.entity';
import { ResidentialComplex } from '../residential-complex/entities/residential-complex.entity';
import { Role } from '../roles/entities/role.entity';

// CacheService se asume provisto por SharedModule o importado directamente
import { CacheModule } from '../../core/infrastructure/cache/cache.module';

@Module({
  imports: [
    ConfigModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({}), // Configurado sin secret fijo; cada llamada usa su propio secret
    TypeOrmModule.forFeature([User, ResidentialComplex, OtpCode, RefreshToken, UserSession, Role]),
    BullModule.registerQueue({ name: OTP_QUEUE_NAME }),
    CacheModule,
  ],
  providers: [
    // Resolvers
    AuthResolver,

    // Services
    AuthService,
    TokenService,
    SessionService,
    OtpService,

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
