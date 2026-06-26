import { Injectable, Logger, HttpStatus } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';

import { ChargeEmission }            from '../entities/charge-emission.entity';
import { FeeCharge }                 from '../entities/fee-charge.entity';
import { ChargeEmissionStatus }      from '../enums/charge-emission-status.enum';
import { ChargeStatus }              from '../enums/charge-status.enum';
import { ChargeRuleTargetType }      from '../enums/charge-rule-target-type.enum';
import { FeeConfigBillingMode }      from '../enums/fee-config-billing-mode.enum';
import { CreateChargeEmissionInput } from '../dto/inputs/create-charge-emission.input';
import { ChargeRule }                from '../dto/inputs/charge-rule.input';
import {
  ChargeEmissionPreviewResponse,
} from '../dto/responses/charge-emission-preview.response';
import {
  ChargeCalculatorService, ResolvedChargeRule,
} from './charge-calculator.service';

import { Unit }     from '../../residential-complex/entities/unit.entity';
import { UnitType } from '../../residential-complex/enums/unit-type.enum';
import { Vehicle }  from '../../vehicles/entities/vehicle.entity';
import { UnitService }              from '../../residential-complex/services/unit.service';
import { ResidentialComplexService } from '../../residential-complex/services/residential-complex.service';
import { AccountingService }        from './accounting.service';

import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { CustomError }      from '../../shared/utils/errors.utils';
import { FinanceErrorCode } from '../../shared/constans/error-codes.constants';
import { SocketService }    from '../../../core/infrastructure/socket/socket.service';
import { SocketEvent }      from '../../../core/infrastructure/socket/socket.events';

/**
 * Orquesta el ciclo de vida de una emisión de cargos (DRAFT → preview →
 * CONFIRMED | CANCELLED) sobre el motor de cálculo puro (ChargeCalculatorService)
 * y la persistencia canónica de UnitCharge (FeeCharge).
 *
 * Aislamiento por complejo en TODAS las operaciones vía ResidentialComplexService.
 */
@Injectable()
export class ChargeEmissionService {

  private readonly logger = new Logger(ChargeEmissionService.name);

  constructor(
    @InjectRepository(ChargeEmission)
    private readonly emissionRepo: Repository<ChargeEmission>,
    @InjectRepository(FeeCharge)
    private readonly chargeRepo: Repository<FeeCharge>,
    @InjectRepository(Vehicle)
    private readonly vehicleRepo: Repository<Vehicle>,
    private readonly dataSource: DataSource,
    private readonly calculator: ChargeCalculatorService,
    private readonly unitService: UnitService,
    private readonly complexService: ResidentialComplexService,
    private readonly accountingService: AccountingService,
    private readonly socketService: SocketService,
  ) {}

  // ════════════════════════════════════════════════════════════════
  // CREATE (DRAFT)
  // ════════════════════════════════════════════════════════════════

  async createChargeEmission(
    input: CreateChargeEmissionInput,
    currentUser: JwtAccessPayload,
  ): Promise<ChargeEmission> {
    await this.complexService.findById(input.complexId, currentUser);

    const exists = await this.emissionRepo.findOne({
      where: { complexId: input.complexId, conceptName: input.conceptName.trim(), period: input.period },
    });
    if (exists && exists.status !== ChargeEmissionStatus.CANCELLED) {
      throw new CustomError({
        message: `Ya existe una emisión "${input.conceptName}" para el período ${input.period}.`,
        statusCode: HttpStatus.CONFLICT,
        errorCode: FinanceErrorCode.CHARGE_EMISSION_ALREADY_EXISTS,
      });
    }

    const dueDate = this.buildDueDate(input.period, input.dueDayOfMonth, input.billingMode ?? FeeConfigBillingMode.ADVANCE);

    const emission = this.emissionRepo.create({
      complexId: input.complexId,
      conceptName: input.conceptName.trim(),
      description: input.description ?? null,
      categoryId: input.categoryId ?? null,
      period: input.period,
      status: ChargeEmissionStatus.DRAFT,
      dueDate,
      billingMode: input.billingMode ?? FeeConfigBillingMode.ADVANCE,
      rules: input.rules as ChargeRule[],
      createdByUserId: currentUser.sub,
    });

    return this.emissionRepo.save(emission);
  }

  // ════════════════════════════════════════════════════════════════
  // PREVIEW (sin persistir)
  // ════════════════════════════════════════════════════════════════

  async previewChargeEmission(
    emissionId: string,
    currentUser: JwtAccessPayload,
  ): Promise<ChargeEmissionPreviewResponse> {
    const emission = await this.findEmissionOrFail(emissionId, currentUser);
    const allUnits = await this.unitService.findAllByComplexInternal(emission.complexId);

    const result = await this.runCalculation(emission, allUnits);

    const unitById = new Map(allUnits.map(u => [u.id, u]));

    return {
      emissionId: emission.id,
      period: emission.period,
      conceptName: emission.conceptName,
      lines: result.lines.map(l => ({
        unitId: l.unitId,
        unitNumber: unitById.get(l.unitId)?.number ?? l.unitId,
        ruleIndex: l.ruleIndex,
        amount: l.amount,
      })),
      unitsCharged: new Set(result.lines.map(l => l.unitId)).size,
      total: result.total,
      conflicts: result.conflicts,
      uncoveredUnits: result.uncoveredUnitIds.map(id => unitById.get(id)?.number ?? id),
      warnings: result.warnings,
    };
  }

  // ════════════════════════════════════════════════════════════════
  // CONFIRM (transacción, idempotente)
  // ════════════════════════════════════════════════════════════════

  async confirmChargeEmission(
    emissionId: string,
    currentUser: JwtAccessPayload,
  ): Promise<ChargeEmission> {
    const emission = await this.findEmissionOrFail(emissionId, currentUser);

    if (emission.status !== ChargeEmissionStatus.DRAFT) {
      throw new CustomError({
        message: `La emisión ya está en estado ${emission.status}; solo se confirman emisiones en DRAFT.`,
        statusCode: HttpStatus.CONFLICT,
        errorCode: FinanceErrorCode.CHARGE_EMISSION_NOT_DRAFT,
      });
    }

    const allUnits = await this.unitService.findAllByComplexInternal(emission.complexId);
    const result = await this.runCalculation(emission, allUnits);

    // Solapamiento: una unidad NO puede estar en dos reglas de la misma emisión.
    if (result.conflicts.length > 0) {
      const detail = result.conflicts
        .map(c => `${c.unitNumber} (reglas ${c.ruleIndexes.join(', ')})`)
        .join('; ');
      throw new CustomError({
        message: `Reglas en conflicto: las siguientes unidades están cubiertas por más de una regla → ${detail}.`,
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: FinanceErrorCode.CHARGE_EMISSION_RULE_OVERLAP,
      });
    }

    if (result.lines.length === 0) {
      throw new CustomError({
        message: 'La emisión no produce ningún cargo (ninguna unidad cumple las reglas).',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: FinanceErrorCode.CHARGE_EMISSION_NO_LINES,
      });
    }

    const { complexId, period, conceptName, dueDate } = emission;
    const description = `${conceptName} — ${period}`;
    const affectedUnitIds = new Set<string>();
    let generated = 0;

    await this.dataSource.transaction(async (manager) => {
      const chargeRepo = manager.getRepository(FeeCharge);

      for (const line of result.lines) {
        // Idempotencia: no duplicar el mismo concepto+período+unidad.
        const existing = await chargeRepo.findOne({
          where: { complexId, unitId: line.unitId, period, description, feeConfigId: IsNull() as any },
        });
        if (existing) continue;

        await chargeRepo.save(chargeRepo.create({
          complexId,
          unitId: line.unitId,
          period,
          dueDate,
          amount: line.amount,
          paidAmount: 0,
          description,
          status: ChargeStatus.PENDING,
        }));
        affectedUnitIds.add(line.unitId);
        generated++;
      }

      // Reconciliar saldo materializado de cada unidad afectada.
      for (const unitId of affectedUnitIds) {
        await this.accountingService.recomputeUnitStatus(manager, complexId, unitId);
      }

      emission.status = ChargeEmissionStatus.CONFIRMED;
      emission.confirmedAt = new Date();
      emission.generatedCount = generated;
      await manager.getRepository(ChargeEmission).save(emission);
    });

    this.logger.log(
      `confirmChargeEmission ${emission.id}: ${generated} cargos generados (${conceptName} — ${period}).`,
    );

    if (generated > 0) {
      this.socketService.emitToComplex(complexId, SocketEvent.FINANCE_CHARGE_NEW, {
        complexId, period, description, created: generated,
      });
    }

    return emission;
  }

  // ════════════════════════════════════════════════════════════════
  // CANCEL
  // ════════════════════════════════════════════════════════════════

  async cancelChargeEmission(
    emissionId: string,
    currentUser: JwtAccessPayload,
    reason?: string,
  ): Promise<ChargeEmission> {
    const emission = await this.findEmissionOrFail(emissionId, currentUser);

    if (emission.status === ChargeEmissionStatus.CONFIRMED) {
      throw new CustomError({
        message: 'No se puede cancelar una emisión ya confirmada; reverse los cargos individualmente.',
        statusCode: HttpStatus.CONFLICT,
        errorCode: FinanceErrorCode.CHARGE_EMISSION_NOT_DRAFT,
      });
    }

    emission.status = ChargeEmissionStatus.CANCELLED;
    emission.cancellationReason = reason ?? null;
    return this.emissionRepo.save(emission);
  }

  // ════════════════════════════════════════════════════════════════
  // QUERIES
  // ════════════════════════════════════════════════════════════════

  async chargeEmissions(
    complexId: string,
    currentUser: JwtAccessPayload,
    status?: ChargeEmissionStatus,
    period?: string,
  ): Promise<ChargeEmission[]> {
    await this.complexService.findById(complexId, currentUser);
    return this.emissionRepo.find({
      where: {
        complexId,
        ...(status ? { status } : {}),
        ...(period ? { period } : {}),
      },
      order: { createdAt: 'DESC' },
    });
  }

  async chargeEmission(
    emissionId: string,
    currentUser: JwtAccessPayload,
  ): Promise<ChargeEmission> {
    return this.findEmissionOrFail(emissionId, currentUser);
  }

  // ════════════════════════════════════════════════════════════════
  // Helpers
  // ════════════════════════════════════════════════════════════════

  private async findEmissionOrFail(
    emissionId: string,
    currentUser: JwtAccessPayload,
  ): Promise<ChargeEmission> {
    const emission = await this.emissionRepo.findOne({ where: { id: emissionId } });
    if (!emission) {
      throw new CustomError({
        message: 'Emisión de cargos no encontrada.',
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: FinanceErrorCode.CHARGE_EMISSION_NOT_FOUND,
      });
    }
    // Aislamiento por complejo (valida que el usuario tenga acceso al complejo).
    await this.complexService.findById(emission.complexId, currentUser);
    return emission;
  }

  /** Resuelve las unidades de cada regla y delega el cálculo al motor puro. */
  private async runCalculation(emission: ChargeEmission, allUnits: Unit[]) {
    const resolved: ResolvedChargeRule[] = [];
    for (let i = 0; i < emission.rules.length; i++) {
      const rule = emission.rules[i];
      const units = await this.resolveRuleUnits(rule, allUnits, emission.complexId);
      resolved.push({
        ruleIndex: i,
        calculationMethod: rule.calculationMethod,
        units,
        amount: rule.amount,
        totalAmount: rule.totalAmount,
        ratePerSqm: rule.ratePerSqm,
        attributeKey: rule.attributeKey,
      });
    }
    return this.calculator.calculate(resolved, allUnits);
  }

  /** Traduce el targeting de una regla a una lista concreta de unidades. */
  private async resolveRuleUnits(
    rule: ChargeRule,
    allUnits: Unit[],
    complexId: string,
  ): Promise<Unit[]> {
    const tv = rule.targetValue ?? {};

    switch (rule.targetType) {
      case ChargeRuleTargetType.ALL:
        return allUnits;

      case ChargeRuleTargetType.UNIT_TYPE: {
        const unitType = tv.unitType as UnitType;
        if (unitType === UnitType.VEHICLE_UNIT) {
          const ids = await this.unitsWithActiveVehicle(complexId);
          return allUnits.filter(u => ids.has(u.id));
        }
        return allUnits.filter(u => u.type === unitType);
      }

      case ChargeRuleTargetType.SPECIFIC_UNITS: {
        const ids = new Set<string>(Array.isArray(tv.unitIds) ? tv.unitIds : []);
        return allUnits.filter(u => ids.has(u.id));
      }

      case ChargeRuleTargetType.TARGET_RULES:
        return allUnits.filter(unit => {
          if (tv.excludeFloor1 && unit.floor === 1) return false;
          if (tv.floorMin != null && unit.floor < tv.floorMin) return false;
          if (tv.floorMax != null && unit.floor > tv.floorMax) return false;
          if (Array.isArray(tv.buildingIds) && tv.buildingIds.length && !tv.buildingIds.includes(unit.buildingId)) return false;
          if (Array.isArray(tv.unitTypes) && tv.unitTypes.length && !tv.unitTypes.includes(unit.type)) return false;
          return true;
        });

      default:
        return [];
    }
  }

  private async unitsWithActiveVehicle(complexId: string): Promise<Set<string>> {
    const rows = await this.vehicleRepo
      .createQueryBuilder('v')
      .select('DISTINCT v.unitId', 'unitId')
      .where('v.complexId = :complexId', { complexId })
      .andWhere("v.status = 'ACTIVE'")
      .andWhere('v.deleted_at IS NULL')
      .getRawMany();
    return new Set(rows.map((r: any) => r.unitId));
  }

  /** Fecha de vencimiento a partir del período YYYY-MM y el día (ADVANCE/ARREARS). */
  private buildDueDate(period: string, day: number, billingMode: FeeConfigBillingMode): Date {
    const [year, month] = period.split('-').map(Number);
    let dueYear = year;
    let dueMonth = month;
    if (billingMode === FeeConfigBillingMode.ARREARS) {
      if (dueMonth === 12) { dueMonth = 1; dueYear += 1; } else { dueMonth += 1; }
    }
    const lastDay = new Date(dueYear, dueMonth, 0).getDate();
    return new Date(dueYear, dueMonth - 1, Math.min(day, lastDay));
  }
}
