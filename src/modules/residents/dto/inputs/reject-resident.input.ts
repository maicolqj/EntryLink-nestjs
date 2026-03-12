import { InputType, Field } from '@nestjs/graphql';
import { IsUUID, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Input para que el COMPLIANCE_OFFICER rechace un residente.
 * La razón del rechazo es OBLIGATORIA.
 */
@InputType()
export class RejectResidentInput {

  @Field(() => String, { description: 'ID del registro de residente a rechazar' })
  @IsUUID()
  residentId: string;

  @Field(() => String, { description: 'Razón del rechazo (obligatoria)' })
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  rejectionReason: string;
}
