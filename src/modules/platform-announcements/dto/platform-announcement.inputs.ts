import { Field, InputType } from '@nestjs/graphql';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';

import {
  AnnouncementAudience,
  AnnouncementCategory,
  AnnouncementChannel,
  AnnouncementFolder,
  AnnouncementTargetMode,
} from '../enums/platform-announcement.enums';
import { ComplexPlan } from '../../residential-complex/enums/complex-plan.enum';
import { ComplexStatus } from '../../residential-complex/enums/complex-status.enum';
import { ComplexEngagement } from '../../residential-complex/enums/complex-engagement.enum';

/**
 * A qué conjuntos va el comunicado.
 *
 * - ALL_COMPLEXES: todos los aprobados (no los que esperan revisión).
 * - SELECTED: `complexIds`.
 * - FILTERED: plan, estado y vinculación. Dentro de cada lista es "cualquiera
 *   de", entre listas es "y". Una lista vacía no filtra.
 */
@InputType()
export class AnnouncementTargetInput {
  @Field(() => AnnouncementTargetMode)
  @IsEnum(AnnouncementTargetMode)
  mode: AnnouncementTargetMode;

  @Field(() => [String], { nullable: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1000)
  @IsUUID('all', { each: true })
  complexIds?: string[];

  @Field(() => [ComplexPlan], { nullable: true })
  @IsOptional()
  @IsArray()
  @IsEnum(ComplexPlan, { each: true })
  plans?: ComplexPlan[];

  @Field(() => [ComplexStatus], { nullable: true })
  @IsOptional()
  @IsArray()
  @IsEnum(ComplexStatus, { each: true })
  statuses?: ComplexStatus[];

  @Field(() => [ComplexEngagement], { nullable: true })
  @IsOptional()
  @IsArray()
  @IsEnum(ComplexEngagement, { each: true })
  engagements?: ComplexEngagement[];
}

/**
 * Lo que llega en el campo `payload` (JSON) del POST multipart. Va por REST y
 * no por GraphQL porque trae las imágenes en la misma petición.
 */
export class SendPlatformAnnouncementDto {
  @IsEnum(AnnouncementCategory)
  category: AnnouncementCategory;

  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  title: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  body: string;

  /** Solo aplica al aviso: el correo va siempre al email del conjunto. */
  @IsEnum(AnnouncementAudience)
  audience: AnnouncementAudience;

  /** Sin canales llega como solo aviso, que es como se enviaba antes. */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsEnum(AnnouncementChannel, { each: true })
  channels?: AnnouncementChannel[];

  @ValidateNested()
  @Type(() => AnnouncementTargetInput)
  target: AnnouncementTargetInput;
}

/** Carpeta, búsqueda y canal del historial. */
@InputType()
export class PlatformAnnouncementFilterInput {
  @Field(() => AnnouncementFolder, { defaultValue: AnnouncementFolder.SENT })
  @IsOptional()
  @IsEnum(AnnouncementFolder)
  folder?: AnnouncementFolder;

  /** Busca en el título y el mensaje. */
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @Field(() => AnnouncementChannel, { nullable: true })
  @IsOptional()
  @IsEnum(AnnouncementChannel)
  channel?: AnnouncementChannel;
}
