import { InputType, Field, Int } from '@nestjs/graphql';
import { IsEnum, IsNotEmpty, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import { ParkingRecordStatus } from '../../enums/parking-record-status.enum';

@InputType({ description: 'Filtros para listar registros de parqueadero' })
export class FilterParkingRecordsInput {

  @Field(() => String, { description: 'ID del complejo' })
  @IsUUID()
  @IsNotEmpty()
  complexId: string;

  @Field(() => ParkingRecordStatus, { nullable: true, description: 'Filtrar por estado' })
  @IsOptional()
  @IsEnum(ParkingRecordStatus)
  status?: ParkingRecordStatus;

  @Field(() => String, { nullable: true, description: 'Búsqueda parcial por placa' })
  @IsOptional()
  @IsString()
  plate?: string;

  @Field(() => Int, { nullable: true, defaultValue: 20 })
  @IsOptional()
  @Min(1)
  @Max(100)
  limit?: number;

  @Field(() => Int, { nullable: true, defaultValue: 0 })
  @IsOptional()
  @Min(0)
  offset?: number;
}
