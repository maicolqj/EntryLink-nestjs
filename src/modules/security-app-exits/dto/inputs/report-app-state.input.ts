import { InputType, Field } from '@nestjs/graphql';
import { IsDate, IsOptional } from 'class-validator';

@InputType()
export class ReportAppStateInput {
  @Field(() => Date, {
    nullable: true,
    description:
      'Hora del cambio en el equipo. Solo para eventos que quedaron en cola sin ' +
      'conexión; si no se envía se usa la hora del servidor',
  })
  @IsOptional()
  @IsDate()
  occurredAt?: Date;
}
