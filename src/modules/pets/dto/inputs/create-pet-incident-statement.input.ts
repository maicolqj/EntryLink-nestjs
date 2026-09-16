import { InputType, Field } from '@nestjs/graphql';
import { IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

/**
 * Descargo de la unidad señalada. Va por GraphQL porque el texto es lo esencial;
 * los soportes con imagen se adjuntan por REST al mismo reporte.
 */
@InputType()
export class CreatePetIncidentStatementInput {
  @Field(() => String)
  @IsUUID()
  incidentId: string;

  @Field(() => String, { description: 'Respuesta de la unidad' })
  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  text: string;
}
