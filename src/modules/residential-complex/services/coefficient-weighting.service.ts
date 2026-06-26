import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { CoefficientWeighting } from '../entities/coefficient-weighting.entity';
import { UpsertCoefficientWeightingInput } from '../dto/inputs/upsert-coefficient-weighting.input';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { ResidentialComplexService } from './residential-complex.service';

const ASSIGNABLE = [
  'base', 'typeMultipliers', 'perBedroom', 'perBathroom',
  'perParking', 'perStorage', 'elevatorPoints', 'houseFloorPoints',
] as const;

@Injectable()
export class CoefficientWeightingService {

  constructor(
    @InjectRepository(CoefficientWeighting)
    private readonly repo: Repository<CoefficientWeighting>,
    private readonly complexService: ResidentialComplexService,
  ) {}

  /** Devuelve la config de pesos del complejo (null si aún no existe). */
  async getByComplex(
    complexId: string,
    currentUser: JwtAccessPayload,
  ): Promise<CoefficientWeighting | null> {
    await this.complexService.findById(complexId, currentUser);
    return this.repo.findOne({ where: { complexId } });
  }

  /** Crea o actualiza la config de pesos del complejo (una fila por complejo). */
  async upsert(
    input: UpsertCoefficientWeightingInput,
    currentUser: JwtAccessPayload,
  ): Promise<CoefficientWeighting> {
    await this.complexService.findById(input.complexId, currentUser);

    let row = await this.repo.findOne({ where: { complexId: input.complexId } });
    if (!row) row = this.repo.create({ complexId: input.complexId });

    for (const key of ASSIGNABLE) {
      if (input[key] !== undefined) (row as any)[key] = input[key];
    }

    return this.repo.save(row);
  }
}
