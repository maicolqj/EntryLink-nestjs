import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { JwtAccessPayload } from '../interfaces/jwt-payload.interface';
import { AccessTokenValidatorService } from '../services/access-token-validator.service';

/**
 * GraphQL y REST. La validación (versión del token, estado de la cuenta y de
 * la sesión) vive en `AccessTokenValidatorService`, que comparte Socket.IO.
 */
@Injectable()
export class JwtAccessStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    configService: ConfigService,
    private readonly validator: AccessTokenValidatorService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
      issuer: configService.get<string>('JWT_ISSUER'),
    });
  }

  validate(payload: JwtAccessPayload): Promise<JwtAccessPayload> {
    return this.validator.validate(payload);
  }
}
