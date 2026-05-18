import { Field, InputType } from "@nestjs/graphql";
import { ParkingPaymentMethod } from "../../enums/parking-payment-method.enum";
import { IsEnum, IsString } from "class-validator";

@InputType({ description: 'Datos para registrar la salida de vehículos visitantes' })
export class ResgiterExitVehicle {
    @Field(() => String, { description: 'ID del vehiculo en parqueadero' })
    @IsString()
    visitorVehicleId: string;

    @Field(() => ParkingPaymentMethod, {defaultValue: ParkingPaymentMethod.CASH, description: 'Metodos de pago del parqueadero' })
    @IsEnum(ParkingPaymentMethod)
    paymentMethod: ParkingPaymentMethod
}