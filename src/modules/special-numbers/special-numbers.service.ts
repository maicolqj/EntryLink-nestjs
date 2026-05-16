import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { SpecialNumber }            from './entities/special-number.entity';
import { CreateSpecialNumberInput } from './dto/create-special-number.input';
import { UpdateSpecialNumberInput } from './dto/update-special-number.input';

import { CustomError }              from '../shared/utils/errors.utils';
import { SpecialNumberErrorCode }   from '../shared/constans/error-codes.constants';
import { JwtAccessPayload }         from '../shared/interfaces/jwt-payload.interface';
import { ValidRoles }               from '../roles/enums/valid-roles';
import { AuditService }             from '../audit/services/audit.service';
import { AuditAction }              from '../audit/enums/audit-action.enum';
import { AuditEntityType }          from '../audit/enums/audit-entity-type.enum';
import { CacheService }             from '../../core/infrastructure/cache/cache.service';
import { BK }                       from '../../core/infrastructure/cache/business-cache.constants';

const MAX_NUMBERS_PER_COMPLEX = 20;

@Injectable()
export class SpecialNumbersService {
  private readonly logger = new Logger(SpecialNumbersService.name);

  constructor(
    @InjectRepository(SpecialNumber)
    private readonly repo: Repository<SpecialNumber>,
    private readonly auditService: AuditService,
    private readonly cacheService: CacheService,
  ) {}

  // ================================================================
  // QUERY — devuelve globales + específicos del complejo, globales primero
  // ================================================================

  async findByComplex(complexId: string, currentUser: JwtAccessPayload): Promise<SpecialNumber[]> {
    if (!this.isSuperAdmin(currentUser)) {
      this.assertComplexAccess(complexId, currentUser);
    }

    const cacheKey = BK.specialNumber.list(complexId);
    const cached = await this.cacheService.get<SpecialNumber[]>({ key: cacheKey });
    if (cached) return cached;

    const numbers = await this.repo
      .createQueryBuilder('sn')
      .where('sn.isGlobal = true OR sn.complexId = :complexId', { complexId })
      .orderBy('sn.isGlobal', 'DESC')
      .addOrderBy('sn.order', 'ASC')
      .getMany();

    await this.cacheService.set({ key: cacheKey, data: numbers, options: { ttl: BK.specialNumber.TTL } });
    return numbers;
  }

  // ================================================================
  // CREATE
  // ================================================================

  async create(input: CreateSpecialNumberInput, currentUser: JwtAccessPayload): Promise<SpecialNumber> {
    const isGlobal = input.isGlobal ?? false;

    if (isGlobal) {
      if (!this.isSuperAdmin(currentUser)) {
        throw new CustomError({
          message: 'Solo el administrador del sistema puede crear números especiales globales',
          statusCode: HttpStatus.FORBIDDEN,
          errorCode: SpecialNumberErrorCode.SPECIAL_NUMBER_ACCESS_DENIED,
        });
      }
    } else {
      if (!input.complexId) {
        throw new CustomError({
          message: 'El campo complexId es requerido para números específicos de un complejo',
          statusCode: HttpStatus.BAD_REQUEST,
          errorCode: SpecialNumberErrorCode.SPECIAL_NUMBER_COMPLEX_REQUIRED,
        });
      }
      if (!this.isSuperAdmin(currentUser)) {
        this.assertComplexAccess(input.complexId, currentUser);
      }
      const count = await this.repo.count({ where: { complexId: input.complexId, isGlobal: false } });
      if (count >= MAX_NUMBERS_PER_COMPLEX) {
        throw new CustomError({
          message: `El complejo ya tiene el máximo de ${MAX_NUMBERS_PER_COMPLEX} números especiales permitidos`,
          statusCode: HttpStatus.BAD_REQUEST,
          errorCode: SpecialNumberErrorCode.MAX_NUMBERS_REACHED,
        });
      }
    }

    const order = input.order ?? (await this.getNextOrder(isGlobal ? null : (input.complexId ?? null), isGlobal));

    const entity = this.repo.create({
      complexId:   isGlobal ? null : (input.complexId ?? null),
      isGlobal,
      name:        input.name.trim(),
      phoneNumber: input.phoneNumber.trim(),
      category:    input.category,
      description: input.description?.trim() ?? null,
      order,
    });

    const saved = await this.repo.save(entity);
    // Global changes affect ALL complexes' list; complex-specific only affects that complex
    if (isGlobal) {
      await this.cacheService.deleteByPrefix('sn:');
    } else {
      await this.cacheService.deleteByPrefix(BK.specialNumber.prefix(saved.complexId));
    }
    this.logger.log(`Número especial creado: ${saved.id} | global: ${isGlobal} | complejo: ${saved.complexId ?? 'n/a'}`);

    void this.auditService.log({
      entityType:      AuditEntityType.SpecialNumber,
      entityId:        saved.id,
      action:          AuditAction.CREATE,
      newValue:        { id: saved.id, name: saved.name, isGlobal: saved.isGlobal, complexId: saved.complexId },
      performedById:   currentUser.sub,
      performedByName: currentUser.email,
      performedByRole: currentUser.roles?.[0] ?? '',
      complexId:       saved.complexId ?? currentUser.complexId ?? '',
      description:     `Número especial ${isGlobal ? 'global' : 'de complejo'} creado: "${saved.name}"`,
    });

    return saved;
  }

  // ================================================================
  // UPDATE — globales: solo SUPER_ADMIN; de complejo: solo su COMPLEX_ROL
  // ================================================================

  async update(input: UpdateSpecialNumberInput, currentUser: JwtAccessPayload): Promise<SpecialNumber> {
    const entity = await this.findOneOrFail(input.id);

    this.assertWriteAccess(entity, currentUser);

    const previous = {
      name:        entity.name,
      phoneNumber: entity.phoneNumber,
      category:    entity.category,
      description: entity.description,
      order:       entity.order,
    };

    if (input.name !== undefined)        entity.name        = input.name.trim();
    if (input.phoneNumber !== undefined) entity.phoneNumber = input.phoneNumber.trim();
    if (input.category !== undefined)    entity.category    = input.category;
    if (input.description !== undefined) entity.description = input.description?.trim() ?? null;
    if (input.order !== undefined)       entity.order       = input.order;

    const saved = await this.repo.save(entity);
    if (saved.isGlobal) {
      await this.cacheService.deleteByPrefix('sn:');
    } else {
      await this.cacheService.deleteByPrefix(BK.specialNumber.prefix(saved.complexId));
    }

    void this.auditService.log({
      entityType:      AuditEntityType.SpecialNumber,
      entityId:        saved.id,
      action:          AuditAction.UPDATE,
      previousValue:   previous,
      newValue:        { name: saved.name, phoneNumber: saved.phoneNumber, category: saved.category, order: saved.order },
      performedById:   currentUser.sub,
      performedByName: currentUser.email,
      performedByRole: currentUser.roles?.[0] ?? '',
      complexId:       saved.complexId ?? currentUser.complexId ?? '',
      description:     `Número especial actualizado: "${saved.name}"`,
    });

    return saved;
  }

  // ================================================================
  // REMOVE — re-ordena los restantes del mismo scope
  // ================================================================

  async remove(id: string, currentUser: JwtAccessPayload): Promise<boolean> {
    const entity = await this.findOneOrFail(id);

    this.assertWriteAccess(entity, currentUser);

    await this.repo.delete(id);

    // Re-ordenar el mismo scope (global o de ese complejo)
    const remaining = await this.repo.find({
      where: entity.isGlobal
        ? { isGlobal: true }
        : { complexId: entity.complexId, isGlobal: false },
      order: { order: 'ASC' },
    });
    if (remaining.length > 0) {
      for (let i = 0; i < remaining.length; i++) {
        remaining[i].order = i + 1;
      }
      await this.repo.save(remaining);
    }

    if (entity.isGlobal) {
      await this.cacheService.deleteByPrefix('sn:');
    } else {
      await this.cacheService.deleteByPrefix(BK.specialNumber.prefix(entity.complexId));
    }
    this.logger.warn(`Número especial eliminado: ${id}`);

    void this.auditService.log({
      entityType:      AuditEntityType.SpecialNumber,
      entityId:        id,
      action:          AuditAction.DELETE,
      previousValue:   { id: entity.id, name: entity.name, isGlobal: entity.isGlobal, complexId: entity.complexId },
      performedById:   currentUser.sub,
      performedByName: currentUser.email,
      performedByRole: currentUser.roles?.[0] ?? '',
      complexId:       entity.complexId ?? currentUser.complexId ?? '',
      description:     `Número especial eliminado: "${entity.name}"`,
    });

    return true;
  }

  // ================================================================
  // REORDER — números de un complejo (COMPLEX_ROL / SUPER_ADMIN)
  // ================================================================

  async reorder(complexId: string, ids: string[], currentUser: JwtAccessPayload): Promise<SpecialNumber[]> {
    if (!this.isSuperAdmin(currentUser)) {
      this.assertComplexAccess(complexId, currentUser);
    }

    const existing = await this.repo.find({ where: { complexId, isGlobal: false } });
    this.validateIdsSubset(ids, existing, complexId);

    const entityMap = new Map(existing.map(e => [e.id, e]));
    const updates = ids.map((id, index) => {
      const e = entityMap.get(id);
      e.order = index + 1;
      return e;
    });
    await this.repo.save(updates);
    await this.cacheService.deleteByPrefix(BK.specialNumber.prefix(complexId));

    // Devuelve globales + complejo reordenado
    return this.findByComplex(complexId, currentUser);
  }

  // ================================================================
  // REORDER GLOBAL — solo SUPER_ADMIN
  // ================================================================

  async reorderGlobal(ids: string[], currentUser: JwtAccessPayload): Promise<SpecialNumber[]> {
    if (!this.isSuperAdmin(currentUser)) {
      throw new CustomError({
        message: 'Solo el administrador del sistema puede reordenar los números globales',
        statusCode: HttpStatus.FORBIDDEN,
        errorCode: SpecialNumberErrorCode.SPECIAL_NUMBER_ACCESS_DENIED,
      });
    }

    const existing = await this.repo.find({ where: { isGlobal: true } });
    this.validateIdsSubset(ids, existing, 'global');

    const entityMap = new Map(existing.map(e => [e.id, e]));
    const updates = ids.map((id, index) => {
      const e = entityMap.get(id);
      e.order = index + 1;
      return e;
    });
    await this.repo.save(updates);
    await this.cacheService.deleteByPrefix('sn:');

    return this.repo.find({ where: { isGlobal: true }, order: { order: 'ASC' } });
  }

  // ================================================================
  // HELPERS PRIVADOS
  // ================================================================

  private async findOneOrFail(id: string): Promise<SpecialNumber> {
    const entity = await this.repo.findOne({ where: { id } });
    if (!entity) {
      throw new CustomError({
        message: `Número especial con ID "${id}" no encontrado`,
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: SpecialNumberErrorCode.SPECIAL_NUMBER_NOT_FOUND,
      });
    }
    return entity;
  }

  private assertWriteAccess(entity: SpecialNumber, user: JwtAccessPayload): void {
    if (entity.isGlobal) {
      if (!this.isSuperAdmin(user)) {
        throw new CustomError({
          message: 'Los números globales solo pueden ser modificados por el administrador del sistema',
          statusCode: HttpStatus.FORBIDDEN,
          errorCode: SpecialNumberErrorCode.SPECIAL_NUMBER_ACCESS_DENIED,
        });
      }
    } else {
      if (!this.isSuperAdmin(user)) {
        this.assertComplexAccess(entity.complexId, user);
      }
    }
  }

  private assertComplexAccess(complexId: string | null, user: JwtAccessPayload): void {
    if (!complexId || user.complexId !== complexId) {
      throw new CustomError({
        message: 'No tienes acceso a los números especiales de este complejo',
        statusCode: HttpStatus.FORBIDDEN,
        errorCode: SpecialNumberErrorCode.SPECIAL_NUMBER_ACCESS_DENIED,
      });
    }
  }

  private isSuperAdmin(user: JwtAccessPayload): boolean {
    return user.roles?.includes(ValidRoles.SUPER_ADMIN_ROL) ?? false;
  }

  private async getNextOrder(complexId: string | null, isGlobal: boolean): Promise<number> {
    const count = await this.repo.count({
      where: isGlobal ? { isGlobal: true } : { complexId, isGlobal: false },
    });
    return count + 1;
  }

  private validateIdsSubset(ids: string[], existing: SpecialNumber[], scope: string): void {
    const existingIds = new Set(existing.map(e => e.id));
    for (const id of ids) {
      if (!existingIds.has(id)) {
        throw new CustomError({
          message: `El número especial con ID "${id}" no pertenece al scope "${scope}"`,
          statusCode: HttpStatus.BAD_REQUEST,
          errorCode: SpecialNumberErrorCode.SPECIAL_NUMBER_COMPLEX_MISMATCH,
        });
      }
    }
  }
}
