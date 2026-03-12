import { ObjectType, Field } from '@nestjs/graphql';
import { Visit }   from '../../entities/visit.entity';
import { Visitor } from '../../entities/visitor.entity';

/**
 * Respuesta cuando el guardia escanea un QR de acceso.
 * Devuelve toda la información necesaria para decidir si se permite la entrada.
 */
@ObjectType()
export class QrValidationResponse {

  @Field(() => Boolean, { description: 'Indica si el QR es válido y permite ingreso' })
  isValid: boolean;

  @Field(() => String, { description: 'Mensaje de resultado del escaneo' })
  message: string;

  @Field(() => Visit, { description: 'Datos de la visita si el QR es válido', nullable: true })
  visit?: Visit;

  @Field(() => Visitor, { description: 'Datos del visitante', nullable: true })
  visitor?: Visitor;
}
