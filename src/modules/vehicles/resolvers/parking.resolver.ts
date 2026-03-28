import { Resolver, Query, Mutation, Args } from '@nestjs/graphql';
import { Logger } from '@nestjs/common';

import { ParkingRecord }             from '../entities/parking-record.entity';
import { ParkingConfig }             from '../entities/parking-config.entity';
import { ParkingRecordsResult }      from '../dto/responses/parking-records-result.response';
import { RegisterParkingEntryInput } from '../dto/inputs/register-parking-entry.input';
import { RegisterParkingExitInput }  from '../dto/inputs/register-parking-exit.input';
import { SaveParkingConfigInput }    from '../dto/inputs/save-parking-config.input';
import { FilterParkingRecordsInput } from '../dto/inputs/filter-parking-records.input';
import { ParkingService }            from '../services/parking.service';

import { Auth }             from '../../shared/decorators/auth.decorator';
import { CurrentUser }      from '../../shared/decorators/current-user.decorator';
import { ValidRoles }       from '../../roles/enums/valid-roles';
import { JwtAccessPayload } from '../../auth/interfaces/jwt-payload.interface';

const ALL_PARKING_ROLES = [
  ValidRoles.SUPER_ADMIN_ROL,
  ValidRoles.COMPLEX_ROL,
  ValidRoles.SECURITY_ROL,
  ValidRoles.SUPERVISOR_ROL,
  ValidRoles.ACCOUNTANT_ROL,
];

@Resolver()
export class ParkingResolver {
  private readonly logger = new Logger(ParkingResolver.name);

  constructor(private readonly parkingService: ParkingService) {}

  // ── Consultas ────────────────────────────────────────────────────

  @Query(() => ParkingRecordsResult, {
    name: 'parkingRecords',
    description: 'Lista paginada de registros de parqueadero visitante. Filtrable por estado y placa.',
  })
  @Auth({ roles: ALL_PARKING_ROLES })
  parkingRecords(
    @Args('filter') filter: FilterParkingRecordsInput,
  ): Promise<ParkingRecordsResult> {
    return this.parkingService.findAll(filter);
  }

  @Query(() => ParkingConfig, {
    name: 'parkingConfig',
    nullable: true,
    description: 'Configuración de tarifas del parqueadero para un complejo.',
  })
  @Auth({ roles: ALL_PARKING_ROLES })
  parkingConfig(
    @Args('complexId') complexId: string,
  ): Promise<ParkingConfig | null> {
    return this.parkingService.findConfig(complexId);
  }

  // ── Mutaciones ───────────────────────────────────────────────────

  @Mutation(() => ParkingRecord, {
    name: 'registerParkingEntry',
    description:
      'Registra la entrada de un vehículo visitante al parqueadero. ' +
      'Genera el número de factura automáticamente (PKG-YYYYMMDD-XXXX). ' +
      'La fecha de entrada la asigna el servidor.',
  })
  @Auth({ roles: [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL, ValidRoles.SECURITY_ROL, ValidRoles.SUPERVISOR_ROL] })
  registerParkingEntry(
    @Args('input') input: RegisterParkingEntryInput,
    @CurrentUser() payload: JwtAccessPayload,
  ): Promise<ParkingRecord> {
    return this.parkingService.registerEntry(input, payload);
  }

  @Mutation(() => ParkingRecord, {
    name: 'registerParkingExit',
    description:
      'Registra la salida, calcula el cobro según la tarifa configurada y cierra el registro. ' +
      'Si paymentMethod = CHARGE_TO_UNIT, genera un FeeCharge en la unidad visitada.',
  })
  @Auth({ roles: [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL, ValidRoles.SECURITY_ROL, ValidRoles.SUPERVISOR_ROL] })
  registerParkingExit(
    @Args('input') input: RegisterParkingExitInput,
    @CurrentUser() payload: JwtAccessPayload,
  ): Promise<ParkingRecord> {
    return this.parkingService.registerExit(input, payload);
  }

  @Mutation(() => ParkingRecord, {
    name: 'cancelParkingRecord',
    description: 'Cancela un registro de parqueadero con estado OPEN.',
  })
  @Auth({ roles: [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL, ValidRoles.SUPERVISOR_ROL] })
  cancelParkingRecord(
    @Args('id') id: string,
    @CurrentUser() payload: JwtAccessPayload,
  ): Promise<ParkingRecord> {
    return this.parkingService.cancelRecord(id, payload.complexId, payload);
  }

  @Mutation(() => ParkingConfig, {
    name: 'saveParkingConfig',
    description:
      'Crea o actualiza la configuración de tarifas del parqueadero para un complejo (upsert). ',
  })
  @Auth({ roles: [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL] })
  saveParkingConfig(
    @Args('input') input: SaveParkingConfigInput,
  ): Promise<ParkingConfig> {
    return this.parkingService.saveConfig(input);
  }
}
