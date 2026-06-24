import { InputType, Field } from '@nestjs/graphql';
import { IsDateString, IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { VisitorIdentityType } from '../../enums/visitor-identity-type.enum';

/**
 * Input para que el RESIDENTE pre-autorice una visita programada.
 * Genera un QR de acceso que el visitante presenta en portería.
 */
@InputType()
export class ScheduleVisitInput {

  // ---- Datos del visitante ----

  @Field(() => String)
  @IsString()
  @MaxLength(100)
  visitorName: string;

  @Field(() => String)
  @IsString()
  @MaxLength(100)
  visitorLastName: string;

  @Field(() => String, { description: 'Número de documento del visitante' })
  @IsString()
  @MaxLength(30)
  visitorIdentity: string;

  @Field(() => VisitorIdentityType, { description: 'Tipo de documento del visitante', defaultValue: VisitorIdentityType.CC })
  @IsOptional()
  @IsEnum(VisitorIdentityType)
  identityType?: VisitorIdentityType;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  visitorPhone?: string;

  // ---- Datos de la visita ----

  @Field(() => String, { description: 'ID del residente que agenda (anfitrión)' })
  @IsUUID()
  hostResidentId: string;

  @Field(() => String, { description: 'ID de la unidad destino' })
  @IsUUID()
  unitId: string;

  @Field(() => String, { description: 'ID del complejo' })
  @IsUUID()
  complexId: string;

  @Field(() => String, { description: 'Fecha y hora de llegada esperada (ISO 8601)' })
  @IsDateString()
  expectedArrivalAt: string;

  @Field(() => String, { description: 'Fecha y hora límite de llegada (ISO 8601)', nullable: true })
  @IsOptional()
  @IsDateString()
  expectedArrivalUntil?: string;

  @Field(() => String, { description: 'Motivo de la visita', nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  purpose?: string;

  @Field(() => String, { description: 'Placa del vehículo (si aplica)', nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  vehiclePlate?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
