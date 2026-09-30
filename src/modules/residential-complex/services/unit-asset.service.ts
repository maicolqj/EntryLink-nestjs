import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';

import { UnitAsset } from '../entities/unit-asset.entity';
import {
  CreateUnitAssetInput,
  UpdateUnitAssetInput,
} from '../dto/inputs/unit-asset.input';
import { UnitService } from './unit.service';
import { CustomError } from '../../shared/utils/errors.utils';
import { ComplexErrorCode } from '../../shared/constans/error-codes.constants';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';

/**
 * Parqueaderos y bodegas propios de cada unidad. Los registra la
 * administración; el residente los ve en "Mi unidad".
 */
@Injectable()
export class UnitAssetService {
  constructor(
    @InjectRepository(UnitAsset)
    private readonly assetRepo: Repository<UnitAsset>,
    private readonly unitService: UnitService,
  ) {}

  async findByUnit(
    unitId: string,
    currentUser: JwtAccessPayload,
  ): Promise<UnitAsset[]> {
    // Valida que la unidad exista y sea del conjunto de quien pregunta.
    await this.unitService.findById(unitId, currentUser);
    return this.listForUnit(unitId);
  }

  /** Sin control de acceso: el llamador ya autorizó la unidad. */
  listForUnit(unitId: string): Promise<UnitAsset[]> {
    return this.assetRepo.find({
      where: { unitId, deletedAt: IsNull() },
      order: { type: 'ASC', code: 'ASC' },
    });
  }

  async create(
    input: CreateUnitAssetInput,
    currentUser: JwtAccessPayload,
  ): Promise<UnitAsset> {
    const unit = await this.unitService.findById(input.unitId, currentUser);
    const asset = this.assetRepo.create({
      unitId: unit.id,
      complexId: unit.complexId,
      type: input.type,
      code: input.code,
      location: input.location ?? null,
    });
    asset.normalize();
    await this.assertCodeAvailable(asset);
    return this.assetRepo.save(asset);
  }

  async update(
    input: UpdateUnitAssetInput,
    currentUser: JwtAccessPayload,
  ): Promise<UnitAsset> {
    const asset = await this.findOrFail(input.id);
    await this.unitService.findById(asset.unitId, currentUser);

    if (input.code !== undefined) asset.code = input.code;
    if (input.location !== undefined) asset.location = input.location;
    asset.normalize();
    await this.assertCodeAvailable(asset);
    return this.assetRepo.save(asset);
  }

  async remove(id: string, currentUser: JwtAccessPayload): Promise<boolean> {
    const asset = await this.findOrFail(id);
    await this.unitService.findById(asset.unitId, currentUser);
    await this.assetRepo.softDelete(asset.id);
    return true;
  }

  /**
   * Una bodega o un parqueadero es de una sola unidad. El índice único lo
   * garantiza; esto da un mensaje que dice CUÁL unidad lo tiene.
   */
  private async assertCodeAvailable(asset: UnitAsset): Promise<void> {
    const taken = await this.assetRepo.findOne({
      where: {
        complexId: asset.complexId,
        type: asset.type,
        code: asset.code,
        deletedAt: IsNull(),
        ...(asset.id ? { id: Not(asset.id) } : {}),
      },
      relations: ['unit'],
    });
    if (!taken) return;

    throw new CustomError({
      message:
        `El código ${asset.code} ya está asignado a la unidad ${taken.unit?.number ?? ''}`.trim(),
      statusCode: HttpStatus.CONFLICT,
      errorCode: ComplexErrorCode.UNIT_ASSET_CODE_TAKEN,
    });
  }

  private async findOrFail(id: string): Promise<UnitAsset> {
    const asset = await this.assetRepo.findOne({
      where: { id, deletedAt: IsNull() },
    });
    if (!asset) {
      throw new CustomError({
        message: 'El parqueadero o bodega no existe',
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: ComplexErrorCode.UNIT_ASSET_NOT_FOUND,
      });
    }
    return asset;
  }
}
