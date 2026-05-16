import { ObjectType, Field } from '@nestjs/graphql';
import { Vehicle } from '../../../vehicles/entities/vehicle.entity';

/**
 * Respuesta al consultar una placa en portería.
 * Permite al guardia saber rápidamente si el vehículo está autorizado.
 */
@ObjectType()
export class PlateCheckResponse {

  @Field(() => Boolean, { description: 'Placa registrada en el complejo' })
  isRegistered: boolean;

  @Field(() => Boolean, { description: 'Vehículo autorizado para ingresar' })
  isAuthorized: boolean;

  @Field(() => String, { description: 'Mensaje explicativo para el guardia' })
  message: string;

  @Field(() => Vehicle, { description: 'Datos del vehículo si está registrado', nullable: true })
  vehicle?: Vehicle;
}
