import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { UnitStatus } from '../enums/unit-status.enum';
import { CacheService } from '../../../core/infrastructure/cache/cache.service';
import { BK } from '../../../core/infrastructure/cache/business-cache.constants';

import { Building }               from '../entities/building.entity';
import { CreateBuildingInput }    from '../dto/inputs/create-building.input';
import { UpdateBuildingInput }    from '../dto/inputs/update-building.input';
import { PaginatedBuildingsResponse } from '../dto/responses/paginated-buildings.response';
import { PaginationInput }        from '../../shared/dto/inputs/pagination.input';
import { CustomError }            from '../../shared/utils/errors.utils';
import { ComplexErrorCode, GeneralErrorCode } from '../../shared/constans/error-codes.constants';
import { JwtAccessPayload }       from '../../shared/interfaces/jwt-payload.interface';
import { ResidentialComplexService } from './residential-complex.service';

@Injectable()
export class BuildingService {
  private readonly logger = new Logger(BuildingService.name);

  constructor(
    @InjectRepository(Building)
    private readonly buildingRepo: Repository<Building>,
    private readonly complexService: ResidentialComplexService,
    private readonly cacheService: CacheService,
  ) {}

  // ================================================================
  // CREAR TORRE/EDIFICIO
  // ================================================================

  async create(
    input: CreateBuildingInput,
    currentUser: JwtAccessPayload,
  ): Promise<Building> {
    if (!input.complexId) {
      throw new CustomError({
        message: 'Debe especificar el ID del complejo (complexId) en el que desea crear la torre',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: GeneralErrorCode.BAD_REQUEST,
      });
    }

    // Verificar que el complejo exista y el usuario tenga acceso
    const complex = await this.complexService.findById(input.complexId, currentUser);

    // Verificar nombre único dentro del complejo
    const existing = await this.buildingRepo.findOne({
      where: {
        complexId: input.complexId,
        name:      input.name.toUpperCase().trim(),
        deletedAt: IsNull(),
      },
    });

    if (existing) {
      throw new CustomError({
        message: `Ya existe una torre con el nombre "${input.name}" en este complejo`,
        statusCode: HttpStatus.CONFLICT,
        errorCode: GeneralErrorCode.CONFLICT,
      });
    }

    const building = this.buildingRepo.create(input);
    const saved    = await this.buildingRepo.save(building);
    await this.cacheService.deleteByPrefix(BK.building.prefix(input.complexId));
    this.logger.log(`Torre creada: ${saved.id} — "${saved.name}" en complejo ${input.complexId}`);
    return saved;
  }

  // ================================================================
  // LISTAR TORRES DE UN COMPLEJO
  // ================================================================

  async findByComplex(
    complexId: string,
    pagination: PaginationInput,
    currentUser: JwtAccessPayload,
  ): Promise<PaginatedBuildingsResponse> {
    await this.complexService.findById(complexId, currentUser);

    const { page, limit } = pagination;
    const cacheKey = BK.building.list(complexId, page, limit);
    const cached = await this.cacheService.get<PaginatedBuildingsResponse>({ key: cacheKey });
    if (cached) return cached;

    const skip = (page - 1) * limit;

    const [items, totalItems] = await this.buildingRepo
      .createQueryBuilder('building')
      .leftJoinAndSelect(
        'building.units',
        'unit',
        'unit.deleted_at IS NULL AND unit.status != :disabled',
        { disabled: UnitStatus.DISABLED },
      )
      .where('building.complexId = :complexId', { complexId })
      .andWhere('building.deleted_at IS NULL')
      .orderBy('building.name', 'ASC')
      .skip(skip)
      .take(limit)
      .getManyAndCount();

    const totalPages = Math.ceil(totalItems / limit);

    const result: PaginatedBuildingsResponse = {
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

    await this.cacheService.set({ key: cacheKey, data: result, options: { ttl: BK.building.TTL } });
    return result;
  }

  // ================================================================
  // BUSCAR POR ID
  // ================================================================

  async findById(
    id: string,
    currentUser: JwtAccessPayload,
  ): Promise<Building> {
    const building = await this.buildingRepo.findOne({
      where:     { id, deletedAt: IsNull() },
      relations: ['complex', 'units'],
    });

    if (!building) {
      throw new CustomError({
        message: `Torre con ID "${id}" no encontrada`,
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: GeneralErrorCode.NOT_FOUND,
      });
    }

    // Verificar acceso al complejo padre
    await this.complexService.findById(building.complexId, currentUser);
    return building;
  }

  // ================================================================
  // ACTUALIZAR
  // ================================================================

  async update(
    input: UpdateBuildingInput & { name?: string },
    currentUser: JwtAccessPayload,
  ): Promise<Building> {
    const building = await this.findById(input.id, currentUser);

    // Si cambia el nombre, verificar que no haya conflicto
    if (input.name && input.name.toUpperCase() !== building.name) {
      const conflict = await this.buildingRepo.findOne({
        where: {
          complexId: building.complexId,
          name:      input.name.toUpperCase().trim(),
          deletedAt: IsNull(),
        },
      });

      if (conflict) {
        throw new CustomError({
          message: `Ya existe una torre con el nombre "${input.name}" en este complejo`,
          statusCode: HttpStatus.CONFLICT,
          errorCode: GeneralErrorCode.CONFLICT,
        });
      }
    }

    Object.assign(building, input);
    const saved = await this.buildingRepo.save(building);
    await this.cacheService.deleteByPrefix(BK.building.prefix(saved.complexId));
    return saved;
  }

  // ================================================================
  // ACTIVAR / DESACTIVAR
  // ================================================================

  async toggleStatus(
    id: string,
    currentUser: JwtAccessPayload,
  ): Promise<Building> {
    const building  = await this.findById(id, currentUser);
    building.status = !building.status;
    const saved = await this.buildingRepo.save(building);
    await this.cacheService.deleteByPrefix(BK.building.prefix(saved.complexId));
    return saved;
  }

  // ================================================================
  // SOFT DELETE
  // ================================================================

  async remove(
    id: string,
    currentUser: JwtAccessPayload,
  ): Promise<{ success: boolean; message: string }> {
    const building = await this.findById(id, currentUser);

    building.deletedAt = new Date();
    await this.buildingRepo.save(building);
    await this.cacheService.deleteByPrefix(BK.building.prefix(building.complexId));
    this.logger.warn(`Torre eliminada (soft): ${id}`);

    return { success: true, message: `Torre "${building.name}" eliminada correctamente` };
  }
}
