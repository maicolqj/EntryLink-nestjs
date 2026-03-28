import { InputType, Field } from '@nestjs/graphql';
import { IsEnum, IsNotEmpty, IsUUID } from 'class-validator';
import { ParkingPaymentMethod } from '../../enums/parking-payment-method.enum';

@InputType({ description: 'Datos para registrar la salida y liquidar el cobro del parqueadero' })
export class RegisterParkingExitInput {

  @Field(() => String, { description: 'ID del ParkingRecord con estado OPEN' })
  @IsUUID()
  @IsNotEmpty()
  id: string;

  @Field(() => ParkingPaymentMethod, { description: 'Método de pago elegido' })
  @IsEnum(ParkingPaymentMethod)
  paymentMethod: ParkingPaymentMethod;
}
