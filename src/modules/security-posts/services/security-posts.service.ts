import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, Repository } from 'typeorm';

import { SecurityPost } from '../entities/security-post.entity';
import { SecurityPostGuard } from '../entities/security-post-guard.entity';
import {
  CreateSecurityPostInput,
  UpdateSecurityPostInput,
} from '../dto/security-post.inputs';
import { findGuardSecurityPost } from '../security-post-routing';

import { ResidentialComplexService } from '../../residential-complex/services/residential-complex.service';
import { Resident } from '../../residents/entities/resident.entity';
import { ResidentStatus } from '../../residents/enums/resident-status.enum';
import { ValidRoles } from '../../roles/enums/valid-roles';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { CustomError } from '../../shared/utils/errors.utils';
import {
  GeneralErrorCode,
  SecurityPostErrorCode,
} from '../../shared/constans/error-codes.constants';
import { SocketService } from '../../../core/infrastructure/socket/socket.service';
import { SocketEvent } from '../../../core/infrastructure/socket/socket.events';

/** Quienes administran las porterías del conjunto. */
const MANAGERS = [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL];

@Injectable()
export class SecurityPostsService {
  private readonly logger = new Logger(SecurityPostsService.name);

  constructor(
    @InjectRepository(SecurityPost)
    private readonly postRepo: Repository<SecurityPost>,
    @InjectRepository(SecurityPostGuard)
    private readonly guardRepo: Repository<SecurityPostGuard>,
    @InjectRepository(Resident)
    private readonly residentRepo: Repository<Resident>,
    private readonly complexService: ResidentialComplexService,
    private readonly socketService: SocketService,
  ) {}

  // ================================================================
  // CONSULTAS
  // ================================================================

  /**
   * Porterías del conjunto. La administración ve también las inactivas; el
   * residente y el vigilante, solo las que se pueden elegir. Lista vacía = el
   * conjunto tiene una sola portería y no hay nada que elegir.
   */
  async list(
    complexId: string,
    currentUser: JwtAccessPayload,
  ): Promise<SecurityPost[]> {
    await this.assertCanRead(complexId, currentUser);
    const manager = this.isManager(currentUser);

    return this.postRepo.find({
      where: {
        complexId,
        deletedAt: IsNull(),
        ...(manager ? {} : { isActive: true }),
      },
      order: { sortOrder: 'ASC', name: 'ASC' },
    });
  }

  /** Vigilantes que hoy están en esa portería. */
  async countGuards(securityPostId: string): Promise<number> {
    return this.guardRepo.count({ where: { securityPostId } });
  }

  /** De esos vigilantes, cuántos pueden recibir llamadas por la app. */
  async countGuardsWithApp(securityPostId: string): Promise<number> {
    const rows: Array<{ total: string }> = await this.guardRepo.manager.query(
      `SELECT COUNT(DISTINCT spg.user_id) AS total
         FROM security_post_guards spg
        WHERE spg.security_post_id = $1
          AND EXISTS (
            SELECT 1 FROM push_subscriptions ps
             WHERE ps.user_id::text = spg.user_id::text
               AND ps.is_active = true
               AND ps.platform::text IN ('ANDROID', 'IOS'))`,
      [securityPostId],
    );
    return Number(rows[0]?.total ?? 0);
  }

  // ================================================================
  // VIGILANTE: EN QUÉ PORTERÍA ESTOY
  // ================================================================

  async myPost(currentUser: JwtAccessPayload): Promise<SecurityPost | null> {
    const ref = await findGuardSecurityPost(
      this.postRepo.manager,
      currentUser.sub,
    );
    return ref ? this.postRepo.findOne({ where: { id: ref.id } }) : null;
  }

  /** El vigilante dice en qué portería está. `null` = en ninguna. */
  async select(
    securityPostId: string | null,
    currentUser: JwtAccessPayload,
  ): Promise<SecurityPost | null> {
    const complexId = currentUser.complexId;
    if (!complexId) {
      throw this.error(
        'Tu cuenta no tiene un conjunto asignado',
        HttpStatus.BAD_REQUEST,
        GeneralErrorCode.BAD_REQUEST,
      );
    }

    if (!securityPostId) {
      await this.guardRepo.delete({ userId: currentUser.sub });
      return null;
    }

    const post = await this.postRepo.findOne({
      where: {
        id: securityPostId,
        complexId,
        isActive: true,
        deletedAt: IsNull(),
      },
    });
    if (!post) throw this.notFound();

    await this.guardRepo.upsert(
      {
        userId: currentUser.sub,
        complexId,
        securityPostId: post.id,
        selectedAt: new Date(),
      },
      ['userId'],
    );
    this.logger.log(
      `Vigilante ${currentUser.sub} en ${post.name} (${complexId})`,
    );
    return post;
  }

  // ================================================================
  // ADMINISTRACIÓN
  // ================================================================

  async create(
    input: CreateSecurityPostInput,
    currentUser: JwtAccessPayload,
  ): Promise<SecurityPost> {
    await this.complexService.assertComplexAccess(input.complexId, currentUser);

    const post = this.postRepo.create({
      complexId: input.complexId,
      name: input.name,
      phoneNumber: input.phoneNumber ?? null,
      sortOrder: input.sortOrder ?? 0,
      isActive: true,
      createdByUserId: currentUser.sub,
      updatedByUserId: currentUser.sub,
    });
    post.normalize();
    await this.assertNameFree(post.complexId, post.name);

    const saved = await this.postRepo.save(post);
    this.notifyChanged(saved.complexId);
    return saved;
  }

  async update(
    input: UpdateSecurityPostInput,
    currentUser: JwtAccessPayload,
  ): Promise<SecurityPost> {
    const post = await this.findOwned(input.id, currentUser);

    if (input.name !== undefined) post.name = input.name;
    if (input.phoneNumber !== undefined) {
      post.phoneNumber = input.phoneNumber || null;
    }
    if (input.sortOrder !== undefined) post.sortOrder = input.sortOrder;
    if (input.isActive !== undefined) post.isActive = input.isActive;
    post.updatedByUserId = currentUser.sub;
    post.normalize();

    if (input.name !== undefined) {
      await this.assertNameFree(post.complexId, post.name, post.id);
    }

    const saved = await this.postRepo.save(post);
    // Una portería apagada deja de recibir: los vigilantes que estaban en ella
    // vuelven a elegir al abrir EntryLink.
    if (!saved.isActive) {
      await this.guardRepo.delete({ securityPostId: saved.id });
    }
    this.notifyChanged(saved.complexId);
    return saved;
  }

  async remove(id: string, currentUser: JwtAccessPayload): Promise<boolean> {
    const post = await this.findOwned(id, currentUser);
    await this.postRepo.update(
      { id: post.id },
      { deletedAt: new Date(), updatedByUserId: currentUser.sub },
    );
    await this.guardRepo.delete({ securityPostId: post.id });
    this.notifyChanged(post.complexId);
    return true;
  }

  // ================================================================
  // INTERNOS
  // ================================================================

  private async findOwned(
    id: string,
    currentUser: JwtAccessPayload,
  ): Promise<SecurityPost> {
    const post = await this.postRepo.findOne({
      where: { id, deletedAt: IsNull() },
    });
    if (!post) throw this.notFound();
    await this.complexService.assertComplexAccess(post.complexId, currentUser);
    return post;
  }

  private async assertNameFree(
    complexId: string,
    name: string,
    exceptId?: string,
  ): Promise<void> {
    const taken = await this.postRepo.count({
      where: {
        complexId,
        name,
        deletedAt: IsNull(),
        ...(exceptId ? { id: Not(exceptId) } : {}),
      },
    });
    if (taken > 0) {
      throw this.error(
        `Ya existe una portería llamada ${name}`,
        HttpStatus.CONFLICT,
        SecurityPostErrorCode.SECURITY_POST_NAME_TAKEN,
      );
    }
  }

  /**
   * El residente lee las de su conjunto; el vigilante las del suyo; la
   * administración con la regla de siempre.
   */
  private async assertCanRead(
    complexId: string,
    currentUser: JwtAccessPayload,
  ): Promise<void> {
    if (
      this.isManager(currentUser) ||
      currentUser.roles?.includes(ValidRoles.SUPERVISOR_ROL) ||
      currentUser.roles?.includes(ValidRoles.COMPILANCE_OFFICER_ROL)
    ) {
      await this.complexService.assertComplexAccess(complexId, currentUser);
      return;
    }
    if (
      currentUser.roles?.includes(ValidRoles.SECURITY_ROL) &&
      currentUser.complexId === complexId
    ) {
      return;
    }
    const lives = await this.residentRepo.count({
      where: {
        userId: currentUser.sub,
        complexId,
        status: In([ResidentStatus.ACTIVE]),
        deletedAt: IsNull(),
      },
    });
    if (lives === 0) {
      throw this.error(
        'No tienes acceso a este conjunto',
        HttpStatus.FORBIDDEN,
        GeneralErrorCode.FORBIDDEN,
      );
    }
  }

  private isManager(user: JwtAccessPayload): boolean {
    return MANAGERS.some((role) => user.roles?.includes(role));
  }

  private notifyChanged(complexId: string): void {
    this.socketService.emitToComplex(
      complexId,
      SocketEvent.SECURITY_POSTS_UPDATED,
      { complexId },
    );
  }

  private notFound(): CustomError {
    return this.error(
      'Portería no encontrada',
      HttpStatus.NOT_FOUND,
      SecurityPostErrorCode.SECURITY_POST_NOT_FOUND,
    );
  }

  private error(
    message: string,
    statusCode: HttpStatus,
    errorCode: string,
  ): CustomError {
    return new CustomError({ message, statusCode, errorCode });
  }
}
