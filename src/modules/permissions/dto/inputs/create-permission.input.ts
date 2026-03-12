import { Field, InputType, registerEnumType } from '@nestjs/graphql';
import { GraphQLJSON } from 'graphql-type-json';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ValidPermissions } from '../../enums/valid-permissions';
import { PermissionLevel } from '../../enums/level-permissions';
import { PermissionDependencyInput } from './permission-dependecy.input';



@InputType({ description: 'Datos requeridos para crear un nuevo permiso' })
export class CreatePermissionInput {

  /**
   * Nombre corto y descriptivo del permiso.
   * @example "LEER_PEDIDOS", "GESTIONAR_USUARIOS"
   */
  @Field(() => ValidPermissions, { description: 'name of the permission' })
  @IsString()
  @IsNotEmpty()
  @MinLength(5)
  @MaxLength(50)
  @Matches(/^[A-ZÁÉÍÓÚ_]+$/, {
    message: 'El nombre debe contener solo mayúsculas y guiones bajos (ej: CREAR_PERMISO)',
  })
  name: ValidPermissions;

  @Field({ description: 'Nombre legible para mostrar en la UI' })
  @IsNotEmpty({ message: 'El nombre para el front del permiso es requerido' })
  @IsString()
  @MaxLength(100, { message: 'El nombre para el front no puede superar los 100 caracteres' })
  @Matches(/^[A-ZÁÉÍÓÚ_]+$/, {
    message: 'El label debe contener solo mayúsculas y guiones bajos (ej: CREAR_PERMISO)',
  })
  label: string;


  /**
   * Descripción opcional que explica el alcance del permiso.
   */
  @Field(() => String, { description: 'description of the permission' })
  @IsString()
  @IsNotEmpty()
  @MinLength(5)
  @MaxLength(150)
  @Matches(/^[A-ZÁÉÍÓÚ ().,]+$/, {
    message: 'La descripción frontal debe contener solo mayúsculas',
  })
  description: string;


  @IsNotEmpty()
  @IsEnum(PermissionLevel, { message: 'Los valores permitidos son LOW, MEDIUM, HIGH, CRITICAL' })
  @Field(() => PermissionLevel, { description: 'level of the permission' })
  level: PermissionLevel;


  /**
   * Grupo o mudulo al que pertenece el permisos (usuario, admin).
   * @see PermissionResource
   */
  @IsString()
  @Field(() => String, { description: 'Recurso del sistema al que aplica el permiso' })
  group: string;

  @IsOptional()
  @Field(() => [PermissionDependencyInput], { description: 'Obliges to have a previous permission to assign another (e.g., need "user:read" to get "user:edit").' })
  dependsOn?: PermissionDependencyInput[];

  /**
   * Estado inicial del permiso. Por defecto `true` (activo).
   */
  @Field(() => Boolean, { nullable: true, defaultValue: true, description: 'Estado inicial del permiso' })
  @IsBoolean()
  @IsOptional()
  status?: boolean;

  @Field(() => Boolean, { nullable: true, defaultValue: false, description: 'Si es true, no podrá borrarse por API' })
  @IsBoolean()
  @IsOptional()
  isSystem?: boolean;
}
