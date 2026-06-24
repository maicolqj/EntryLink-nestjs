import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn,
  ManyToOne, JoinColumn, Index,
} from 'typeorm';
import { ObjectType, Field, ID, Float, Int } from '@nestjs/graphql';

import { RecurringChargeType } from '../enums/recurring-charge-type.enum';
import { FeeConfigBillingMode } from '../enums/fee-config-billing-mode.enum';
import { RecurringChargeDistribution } from '../enums/recurring-charge-distribution.enum';
import { RecurringChargeTrigger } from '../enums/recurring-charge-trigger.enum';
import { FeeConfigTargetRules } from '../dto/inputs/fee-config-target-rules.input';
import { PucAccount } from './puc-account.entity';
import { Unit } from '../../residential-complex/entities/unit.entity';
import { moneyColumn } from '../utils/numeric.transformer';

/**
 * Cobro recurrente programado para una unidad (o para todas).
 * El cron de causación genera la factura (AccountingHeader INVOICE) en cada
 * período y avanza `currentInstallment`; para diferidos se desactiva al
 * alcanzar `totalInstallments`.
 */
@ObjectType()
@Entity('recurring_charges')
@Index(['complexId', 'isActive'])
@Index(['complexId', 'unitId'])
export class RecurringCharge {

  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Field()
  @Column({ type: 'varchar', length: 200 })
  concept: string;

  @Field(() => RecurringChargeType)
  @Column({ type: 'enum', enum: RecurringChargeType })
  type: RecurringChargeType;

  @Field(() => Float)
  @Column({ type: 'numeric', precision: 18, scale: 2, transformer: moneyColumn })
  amount: number;

  /** Solo diferidos: nº total de cuotas. Null en indefinido / único. */
  @Field(() => Int, { nullable: true })
  @Column({ type: 'int', nullable: true })
  totalInstallments?: number | null;

  @Field(() => Int)
  @Column({ type: 'int', default: 0 })
  currentInstallment: number;

  @Field()
  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  /** Día del mes en que se causa (1-28). */
  @Field(() => Int)
  @Column({ type: 'int', default: 1 })
  billingDay: number;

  /**
   * Modo de facturación: ADVANCE (anticipado, vence en el mismo período) o
   * ARREARS (mes vencido, vence el `billingDay` del mes SIGUIENTE al causado).
   * Default ARREARS: un cargo causado hoy no nace vencido.
   */
  @Field(() => FeeConfigBillingMode)
  @Column({ type: 'enum', enum: FeeConfigBillingMode, default: FeeConfigBillingMode.ARREARS })
  billingMode: FeeConfigBillingMode;

  /**
   * Último período YYYY-MM ya causado. Idempotencia del cron de causación:
   * si coincide con el período actual, no se vuelve a causar.
   */
  @Field(() => String, { nullable: true })
  @Column({ type: 'varchar', length: 7, nullable: true })
  lastBilledPeriod?: string | null;

  /** Cuenta de ingreso PUC a acreditar al causar (ej. 4225 cuotas admón). */
  @Field()
  @Column({ type: 'uuid' })
  incomeAccountId: string;

  @ManyToOne(() => PucAccount, { onDelete: 'RESTRICT', eager: false })
  @JoinColumn({ name: 'incomeAccountId' })
  incomeAccount: PucAccount;

  // ─── Tenant / unidad ──────────────────────────────────────────

  @Field()
  @Column({ type: 'uuid' })
  complexId: string;

  /** Null = aplica a TODAS las unidades (se prorratea por coeficiente). */
  @Field(() => String, { nullable: true })
  @Column({ type: 'uuid', nullable: true })
  unitId?: string | null;

  @ManyToOne(() => Unit, { nullable: true, onDelete: 'CASCADE', eager: false })
  @JoinColumn({ name: 'unitId' })
  unit?: Unit | null;

  /**
   * Si true, `amount` se reparte por coeficiente de copropiedad.
   * @deprecated Usar `distribution`. Se mantiene por compatibilidad; al crear se
   * deriva de `distribution` (true sólo cuando distribution = COEFFICIENT).
   */
  @Field()
  @Column({ type: 'boolean', default: false })
  prorateByCoefficient: boolean;

  /**
   * Método de reparto del monto entre las unidades elegidas:
   * COEFFICIENT (por coeficiente renormalizado), EQUAL (partes iguales) o
   * FIXED_PER_UNIT (el monto es por cada unidad).
   */
  @Field(() => RecurringChargeDistribution)
  @Column({ type: 'enum', enum: RecurringChargeDistribution, default: RecurringChargeDistribution.FIXED_PER_UNIT })
  distribution: RecurringChargeDistribution;

  /**
   * Mecanismo de asignación. MANUAL: segmentación a unidades. VEHICLE: un cargo
   * por cada vehículo ACTIVO (parqueadero); ignora segmentación.
   */
  @Field(() => RecurringChargeTrigger)
  @Column({ type: 'enum', enum: RecurringChargeTrigger, default: RecurringChargeTrigger.MANUAL })
  triggerType: RecurringChargeTrigger;

  /**
   * Solo triggerType=VEHICLE: tipos de vehículo a los que aplica (CAR, MOTORCYCLE…).
   * Null/vacío = todos los tipos. Ej: "Parqueadero carros" → [CAR, VAN, TRUCK].
   */
  @Field(() => [String], { nullable: true })
  @Column({ type: 'varchar', array: true, nullable: true })
  vehicleTypes: string[] | null;

  /**
   * Reglas de segmentación (a quién se cobra). Si `unitId` y `targetUnitIds`
   * son null, se parte de TODAS las unidades del complejo y se filtra por estas
   * reglas (excludeFloor1 / floorMin / floorMax / buildingIds / unitTypes).
   */
  @Field(() => FeeConfigTargetRules, { nullable: true })
  @Column({ type: 'jsonb', nullable: true })
  targetRules: FeeConfigTargetRules | null;

  /**
   * Selección manual de unidades. Si tiene elementos, tiene prioridad sobre
   * `unitId` y `targetRules`.
   */
  @Field(() => [String], { nullable: true })
  @Column({ type: 'uuid', array: true, nullable: true })
  targetUnitIds: string[] | null;

  // ─── Pronto pago (override del global) ─────────────────────────

  /** % de descuento por pronto pago. Null = usar el global del complejo. */
  @Field(() => Float, { nullable: true })
  @Column({ type: 'decimal', precision: 5, scale: 2, nullable: true })
  earlyDiscountPct: number | null;

  /** Día del mes (1-28) límite del pronto pago. Null = usar el global. */
  @Field(() => Int, { nullable: true })
  @Column({ type: 'int', nullable: true })
  earlyDiscountDay: number | null;

  // ─── Auditoría ────────────────────────────────────────────────

  @Field()
  @Column({ type: 'uuid' })
  createdByUserId: string;

  @Field()
  @CreateDateColumn()
  createdAt: Date;

  @Field()
  @UpdateDateColumn()
  updatedAt: Date;
}
