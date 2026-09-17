import { InputType, Field } from '@nestjs/graphql';
import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

@InputType()
export class ResolveListingReportInput {
  @Field(() => String)
  @IsUUID()
  reportId: string;

  /**
   * `true` retira la publicación; `false` la devuelve a la vitrina si estaba
   * pausada por reportes. No hay un tercer camino a propósito: un reporte que
   * se queda "en estudio" para siempre deja el aviso escondido sin que nadie lo
   * haya decidido.
   */
  @Field(() => Boolean)
  @IsBoolean()
  accept: boolean;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
