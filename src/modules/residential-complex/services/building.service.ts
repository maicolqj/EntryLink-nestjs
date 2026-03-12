import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';

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
  ) {}

  // ================================================================
  // CREAR TORRE/EDIFICIO
  // ================================================================

  async create(
    input: CreateBuildingInput,
    currentUser: JwtAccessPayload,
  ): Promise<Building> {
    // Verificar que el complejo exista y el usuario tenga acceso
    const complex = await this.complexService.findById(input.complexId, currentUser);

    // Verificar código único dentro del complejo
    const existing = await this.buildingRepo.findOne({
      where: {
        complexId: input.complexId,
        code:      input.code.toUpperCase().trim(),
        deletedAt: IsNull(),
      },
    });

    if (existing) {
      throw new CustomError({
        message: `Ya existe una torre con el código "${input.code}" en este complejo`,
        statusCode: HttpStatus.CONFLICT,
        errorCode: GeneralErrorCode.CONFLICT,
      });
    }

    const building = this.buildingRepo.create(input);
    const saved    = await this.buildingRepo.save(building);
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
    // Verificar acceso al complejo
    await this.complexService.findById(complexId, currentUser);

    const { page, limit } = pagination;
    const skip = (page - 1) * limit;

    const [items, totalItems] = await this.buildingRepo.findAndCount({
      where:  { complexId, deletedAt: IsNull() },
      order:  { name: 'ASC' },
      skip,
      take:   limit,
      relations: ['units'],
    });

    const totalPages = Math.ceil(totalItems / limit);

    return {
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
    input: UpdateBuildingInput,
    currentUser: JwtAccessPayload,
  ): Promise<Building> {
    const building = await this.findById(input.id, currentUser);

    // Si cambia el código, verificar que no haya conflicto
    if (input.code && input.code.toUpperCase() !== building.code) {
      const conflict = await this.buildingRepo.findOne({
        where: {
          complexId: building.complexId,
          code:      input.code.toUpperCase().trim(),
          deletedAt: IsNull(),
        },
      });

      if (conflict) {
        throw new CustomError({
          message: `Ya existe una torre con el código "${input.code}" en este complejo`,
          statusCode: HttpStatus.CONFLICT,
          errorCode: GeneralErrorCode.CONFLICT,
        });
      }
    }

    Object.assign(building, input);
    return this.buildingRepo.save(building);
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
    return this.buildingRepo.save(building);
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
    this.logger.warn(`Torre eliminada (soft): ${id}`);

    return { success: true, message: `Torre "${building.name}" eliminada correctamente` };
  }
}
