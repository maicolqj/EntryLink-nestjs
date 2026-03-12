import { InputType, Field } from '@nestjs/graphql';
import { IsUUID, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Input para que el COMPLIANCE_OFFICER apruebe un residente.
 */
@InputType()
export class ApproveResidentInput {

  @Field(() => String, { description: 'ID del registro de residente a aprobar' })
  @IsUUID()
  residentId: string;

  @Field(() => String, { description: 'Notas opcionales del Compliance Officer', nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
