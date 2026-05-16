import { InputType, Field } from '@nestjs/graphql';
import { IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { VisitType } from '../../enums/visit-type.enum';
import GraphQLJSON from 'graphql-type-json';

/**
 * Input para que el guardia registre una visita sin cita (WALK_IN, DELIVERY, SERVICE_PROVIDER).
 * Si el visitante ya existe en el complejo, se reutiliza su registro (por identidad).
 */
@InputType()
export class RegisterWalkInInput {

  // ---- Datos del visitante (si no existe en BD, se crea automáticamente) ----

  @Field(() => String)
  @IsString()
  @MaxLength(100)
  visitorName: string;

  @Field(() => String)
  @IsString()
  @MaxLength(100)
  visitorLastName: string;

  @Field(() => String, { description: 'Número de documento' })
  @IsString()
  @MaxLength(30)
  visitorIdentity: string;

  @Field(() => String, { nullable: true, description: 'Teléfono del visitante' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  visitorPhone?: string;

  @Field(() => String, { nullable: true, description: 'URL de la foto capturada en portería' })
  @IsOptional()
  @IsString()
  visitorPhotoUrl?: string;

  @Field(() => GraphQLJSON, { nullable: true })
  @IsOptional()
  metadata?: Record<string, any>;

  // ---- Datos de la visita ----

  @Field(() => String, { description: 'ID del residente anfitrión' })
  @IsUUID()
  hostResidentId: string;

  @Field(() => String, { description: 'ID de la unidad destino' })
  @IsUUID()
  unitId: string;

  @Field(() => String, { description: 'ID del complejo' })
  @IsUUID()
  complexId: string;

  @Field(() => VisitType, { defaultValue: VisitType.WALK_IN })
  @IsOptional()
  @IsEnum(VisitType)
  type?: VisitType;

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

  @Field(() => String, { description: 'Observaciones del guardia', nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
