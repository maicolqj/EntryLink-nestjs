import { InputType, Field } from '@nestjs/graphql';
import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

@InputType()
export class AddMaintenanceCommentInput {
  @Field(() => String)
  @IsUUID()
  ticketId: string;

  @Field(() => String)
  @IsString()
  @MinLength(2)
  @MaxLength(2000)
  message: string;

  /**
   * Nota que solo ve la administración. El residente no debería leer la
   * negociación del precio con el proveedor, y el proveedor no debería
   * enterarse de lo que la administración opina de su trabajo.
   *
   * Solo el personal puede marcarla: el servicio ignora el `true` que venga de
   * un residente en vez de fallar —un comentario perdido por una casilla es
   * peor que un comentario público—.
   */
  @Field(() => Boolean, { nullable: true, defaultValue: false })
  @IsOptional()
  @IsBoolean()
  isInternal?: boolean;
}
