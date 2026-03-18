import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Guard JWT para endpoints REST (Controllers HTTP).
 * A diferencia de JwtAuthGuard (que extrae el request del contexto GraphQL),
 * este opera directamente sobre el contexto HTTP estándar de Express.
 */
@Injectable()
export class JwtRestGuard extends AuthGuard('jwt') {}
