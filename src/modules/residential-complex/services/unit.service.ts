import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { CacheService } from '../../../core/infrastructure/cache/cache.service';
import { BK } from '../../../core/infrastructure/cache/business-cache.constants';

import { Unit }                 from '../entities/unit.entity';
import { CreateUnitInput }      from '../dto/inputs/create-unit.input';
import { UpdateUnitInput }      from '../dto/inputs/update-unit.input';
import { PaginatedUnitsResponse } from '../dto/responses/paginated-units.response';
import { PaginationInput }      from '../../shared/dto/inputs/pagination.input';
import { UnitStatus }           from '../enums/unit-status.enum';
import { CustomError }          from '../../shared/utils/errors.utils';
import { ComplexErrorCode, GeneralErrorCode } from '../../shared/constans/error-codes.constants';
import { JwtAccessPayload }     from '../../shared/interfaces/jwt-payload.interface';
import { ResidentialComplexService } from './residential-complex.service';
import { BuildingService }      from './building.service';

@Injectable()
export class UnitService {
  private readonly logger = new Logger(UnitService.name);

  constructor(
    @InjectRepository(Unit)
    private readonly unitRepo: Repository<Unit>,
    private readonly complexService: ResidentialComplexService,
    private readonly buildingService: BuildingService,
    private readonly cacheService: CacheService,
  ) {}

  // ================================================================
  // CREAR UNIDAD (CASA O APARTAMENTO)
  // ================================================================

  async create(
    input: CreateUnitInput,
    currentUser: JwtAccessPayload,
  ): Promise<Unit> {

    // 1. Verificar acceso al complejo
    const response = await this.complexService.findById(input.complexId, currentUser);


    // 2. Si viene buildingId, verificar que la torre exista y pertenezca al complejo
    if (input.buildingId) {
      const building = await this.buildingService.findById(input.buildingId, currentUser);
      
      if (building.complexId !== input.complexId) {
        throw new CustomError({
          message: 'La torre especificada no pertenece al complejo indicado',
          statusCode: HttpStatus.BAD_REQUEST,
          errorCode: GeneralErrorCode.BAD_REQUEST,
        });
      }
    }

    // 3. Verificar límite del plan
    const currentCount = await this.unitRepo.count({
      where: { complexId: input.complexId, deletedAt: IsNull() },
    });
    
    await this.complexService.assertUnitsLimit(input.complexId, currentCount);

    // 4. Verificar número de unidad único dentro del mismo scope
    const whereClause = input.buildingId
      ? { complexId: input.complexId, buildingId: input.buildingId, number: input.number.toUpperCase().trim(), deletedAt: IsNull() }
      : { complexId: input.complexId, buildingId: IsNull(),          number: input.number.toUpperCase().trim(), deletedAt: IsNull() };

    const existing = await this.unitRepo.findOne({ where: whereClause as any });
    if (existing) {
      throw new CustomError({
        message: `Ya existe una unidad con el número "${input.number}" en este contexto`,
        statusCode: HttpStatus.CONFLICT,
        errorCode: ComplexErrorCode.UNIT_ALREADY_EXISTS,
      });
    }

    const unit  = this.unitRepo.create({ ...input, complexId: input.complexId, status: UnitStatus.AVAILABLE });
    const saved = await this.unitRepo.save(unit);
    await this.cacheService.deleteByPrefix(BK.unit.prefix(input.complexId));
    this.logger.log(`Unidad creada: ${saved.id} — N°${saved.number} en complejo ${input.complexId}`);
    return saved;
  }

  // ================================================================
  // LISTAR UNIDADES DE UN COMPLEJO (con filtros opcionales)
  // ================================================================

  async findByComplex(
    complexId: string,
    pagination: PaginationInput,
    currentUser: JwtAccessPayload,
    buildingId?: string,
    status?: UnitStatus,
  ): Promise<PaginatedUnitsResponse> {
    await this.complexService.findById(complexId, currentUser);

    const { page, limit } = pagination;
    const cacheKey = BK.unit.list(complexId, page, limit, buildingId, status);
    const cached = await this.cacheService.get<PaginatedUnitsResponse>({ key: cacheKey });
    if (cached) return cached;

    const skip = (page - 1) * limit;

    const qb = this.unitRepo
      .createQueryBuilder('unit')
      .leftJoinAndSelect('unit.building', 'building')
      .where('unit.complexId = :complexId', { complexId })
      .andWhere('unit.deleted_at IS NULL');

    if (buildingId) qb.andWhere('unit.building_id = :buildingId', { buildingId });
    if (status)     qb.andWhere('unit.status = :status',          { status });

    qb.orderBy('unit.floor', 'ASC')
      .addOrderBy('unit.number', 'ASC')
      .skip(skip)
      .take(limit);

    const [items, totalItems] = await qb.getManyAndCount();
    const totalPages = Math.ceil(totalItems / limit);

    const result: PaginatedUnitsResponse = {
      items,
      pagination: {
        currentPage:    page,
        itemsPerPage:   limit,
        totalItems,
        totalPages,
        hasNextPage:     page < totalPages,
        hasPreviousPage: page > 1,
      },
    };

    await this.cacheService.set({ key: cacheKey, data: result, options: { ttl: BK.unit.TTL } });
    return result;
  }

  // ================================================================
  // MÉTODO INTERNO PARA USO DE OTROS MÓDULOS
  // ================================================================

  /**
   * Devuelve todas las unidades activas de un complejo sin validar acceso.
   * Uso interno: FinanceService para generar cargos en bulk.
   */
  async findAllByComplexInternal(complexId: string): Promise<Unit[]> {
    const cacheKey = BK.unit.all(complexId);
    const cached = await this.cacheService.get<Unit[]>({ key: cacheKey });
    if (cached) return cached;

    const units = await this.unitRepo.find({
      where: { complexId, deletedAt: null as any },
      order: { number: 'ASC' },
    });

    await this.cacheService.set({ key: cacheKey, data: units, options: { ttl: BK.unit.TTL } });
    return units;
  }

  async findComplexIdByUnitInternal(unitId: string): Promise<string | null> {
    const unit = await this.unitRepo.findOne({
      select: ['complexId'],
      where: { id: unitId, deletedAt: IsNull() },
    });
    return unit?.complexId ?? null;
  }

  // ================================================================
  // BUSCAR POR ID
  // ================================================================

  async findById(
    id: string,
    currentUser: JwtAccessPayload,
  ): Promise<Unit> {
    const unit = await this.unitRepo.findOne({
      where:     { id, deletedAt: IsNull() },
      relations: ['complex', 'building'],
    });

    if (!unit) {
      throw new CustomError({
        message: `Unidad con ID "${id}" no encontrada`,
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: ComplexErrorCode.UNIT_NOT_FOUND,
      });
    }

    await this.complexService.findById(unit.complexId, currentUser);
    return unit;
  }

  // ================================================================
  // ACTUALIZAR
  // ================================================================

  async update(
    input: UpdateUnitInput,
    currentUser: JwtAccessPayload,
  ): Promise<Unit> {
    const unit = await this.findById(input.id, currentUser);

    // No permitir marcar como AVAILABLE si está OCCUPIED (lo hace el módulo de residentes)
    if (input.status === UnitStatus.AVAILABLE && unit.status === UnitStatus.OCCUPIED) {
      throw new CustomError({
        message: 'No puedes liberar una unidad ocupada directamente. Gestiona el traslado desde el módulo de residentes.',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: ComplexErrorCode.UNIT_IS_OCCUPIED,
      });
    }

    Object.assign(unit, input);
    const saved = await this.unitRepo.save(unit);
    await this.cacheService.deleteByPrefix(BK.unit.prefix(saved.complexId));
    return saved;
  }

  // ================================================================
  // SOFT DELETE
  // ================================================================

  async remove(
    id: string,
    currentUser: JwtAccessPayload,
  ): Promise<{ success: boolean; message: string }> {
    const unit = await this.findById(id, currentUser);

    if (unit.status === UnitStatus.OCCUPIED) {
      throw new CustomError({
        message: 'No se puede eliminar una unidad que está ocupada. Gestiona el traslado primero.',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: ComplexErrorCode.UNIT_IS_OCCUPIED,
      });
    }

    unit.deletedAt = new Date();
    unit.status = UnitStatus.DISABLED;
    await this.unitRepo.save(unit);
    await this.cacheService.deleteByPrefix(BK.unit.prefix(unit.complexId));
    this.logger.warn(`Unidad eliminada (soft): ${id}`);

    return { success: true, message: `Unidad N°${unit.number} eliminada correctamente` };
  }

  // ================================================================
  // MÉTODO INTERNO — para uso del módulo de residentes
  // ================================================================

  async setOccupied(id: string, occupied: boolean): Promise<void> {
    await this.unitRepo.update(id, {
      status: occupied ? UnitStatus.OCCUPIED : UnitStatus.AVAILABLE,
    });
    const complexId = await this.findComplexIdByUnitInternal(id);
    if (complexId) await this.cacheService.deleteByPrefix(BK.unit.prefix(complexId));
  }
}
