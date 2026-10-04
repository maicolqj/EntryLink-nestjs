import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, Repository } from 'typeorm';

import { Resident } from '../residents/entities/resident.entity';
import { ResidentStatus } from '../residents/enums/resident-status.enum';
import { Vehicle } from '../vehicles/entities/vehicle.entity';
import { VehicleStatus } from '../vehicles/enums/vehicle-status.enum';
import { ParkingRotationConfig } from '../vehicles/entities/parking-rotation-config.entity';
import { UnitAssetService } from '../residential-complex/services/unit-asset.service';
import { CustomError } from '../shared/utils/errors.utils';
import { ResidentErrorCode } from '../shared/constans/error-codes.constants';
import { JwtAccessPayload } from '../shared/interfaces/jwt-payload.interface';
import { MyUnitResponse, UnitMember } from './dto/my-unit.response';
import { effectiveNextRotation } from '../vehicles/utils/rotation-schedule';

/** Vehículos que ya no están en el conjunto y no tiene sentido mostrar. */
const HIDDEN_VEHICLE_STATUSES = [VehicleStatus.REJECTED, VehicleStatus.REMOVED];

/**
 * "Mi unidad": lo que el residente tiene en el conjunto —datos de la unidad,
 * parqueaderos y bodegas, vehículos— y con quién vive.
 *
 * La unidad sale de la ficha ACTIVA del residente en ese conjunto, nunca de un
 * id que mande la app: así nadie consulta una unidad ajena.
 */
@Injectable()
export class MyUnitService {
  constructor(
    @InjectRepository(Resident)
    private readonly residentRepo: Repository<Resident>,
    @InjectRepository(Vehicle)
    private readonly vehicleRepo: Repository<Vehicle>,
    @InjectRepository(ParkingRotationConfig)
    private readonly rotationRepo: Repository<ParkingRotationConfig>,
    private readonly assetService: UnitAssetService,
  ) {}

  async find(
    complexId: string,
    currentUser: JwtAccessPayload,
  ): Promise<MyUnitResponse> {
    const me = await this.residentRepo.findOne({
      where: {
        userId: currentUser.sub,
        complexId,
        status: ResidentStatus.ACTIVE,
        deletedAt: IsNull(),
      },
      relations: ['unit', 'unit.building'],
    });

    if (!me?.unit) {
      throw new CustomError({
        message: 'No tienes una unidad activa en este conjunto',
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: ResidentErrorCode.RESIDENT_NOT_FOUND,
      });
    }

    const unitId = me.unit.id;
    const [assets, vehicles, residents, rotation] = await Promise.all([
      this.assetService.listForUnit(unitId),
      this.vehicleRepo.find({
        where: {
          unitId,
          status: Not(In(HIDDEN_VEHICLE_STATUSES)),
          deletedAt: IsNull(),
        },
        relations: ['fixedParkingAsset'],
        order: { createdAt: 'ASC' },
      }),
      this.residentRepo.find({
        where: {
          unitId,
          status: ResidentStatus.ACTIVE,
          deletedAt: IsNull(),
        },
        relations: ['user'],
      }),
      this.rotationRepo.findOne({ where: { complexId, isActive: true } }),
    ]);

    return {
      unit: me.unit,
      assets,
      vehicles,
      nextRotationAt: effectiveNextRotation(
        rotation?.nextExecutionAt,
        new Date(),
      ),
      members: residents.map((r) => this.toMember(r, me.id)).sort(byHousehold),
    };
  }

  private toMember(resident: Resident, myResidentId: string): UnitMember {
    return {
      residentId: resident.id,
      name: resident.user?.name ?? 'Residente',
      lastName: resident.user?.lastName ?? null,
      phoneNumber: resident.user?.phoneNumber ?? null,
      type: resident.type,
      isMainResident: resident.isMainResident,
      startDate: resident.startDate ?? null,
      isMe: resident.id === myResidentId,
    };
  }
}

/** Primero el principal, luego por antigüedad en la unidad. */
function byHousehold(a: UnitMember, b: UnitMember): number {
  if (a.isMainResident !== b.isMainResident) return a.isMainResident ? -1 : 1;
  const at = a.startDate ? new Date(a.startDate).getTime() : 0;
  const bt = b.startDate ? new Date(b.startDate).getTime() : 0;
  return at - bt;
}
