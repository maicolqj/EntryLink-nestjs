import { InputType, Field } from '@nestjs/graphql';
import { IsUUID, ArrayMinSize, ArrayNotEmpty, IsOptional } from 'class-validator';

@InputType()
export class MoveResidentsToUnitInput {

  @Field(() => [String])
  @ArrayNotEmpty()
  @ArrayMinSize(1)
  @IsUUID('all', { each: true })
  residentIds: string[];

  @Field(() => String)
  @IsUUID()
  newUnitId: string;

  /**
   * Requerido cuando el traslado genera más de un residente principal en la unidad destino.
   * Debe ser el ID de uno de los residentes trasladados o de un residente activo en la unidad destino.
   */
  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsUUID()
  newMainResidentId?: string;

}
