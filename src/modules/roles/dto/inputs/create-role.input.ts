import { InputType, Int, Field } from '@nestjs/graphql';
import { IsString, IsNotEmpty, MinLength, MaxLength, Matches,IsArray, IsOptional, IsBoolean, IsInt } from 'class-validator';
import GraphQLJSON from 'graphql-type-json';
import { ValidRoles } from '../../enums/valid-roles';

@InputType()
export class CreateRoleInput {

  @IsString()
  @IsNotEmpty()
  @MinLength(5)
  @MaxLength(50)
  @Matches(/^[A-Z_]+$/, {
    message: 'El nombre debe contener solo mayúsculas y guiones bajos (ej: CREAR_PERMISO)',
  })
  @Field(() => ValidRoles, { description: 'name of the permisison', nullable: false })
  name: ValidRoles
  
  @IsString()
  @IsNotEmpty()
  @MinLength(5)
  @MaxLength(50)
  @Matches(/^[A-ZÁÉÍÓÚ ]+$/, { 
    message: 'El nombre frontal debe contener solo mayúsculas',
  })
  @Field(() => String, { description: 'name of the permisison visiblen to end user', nullable: false })
  frontName: string
  
  @IsString() 
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(15)
  @Field(() => String, { description: 'icon of the permisison', nullable: false })
  icon: string


  @Field(() => String, { description: 'description of the permisison', nullable: false })
  @IsString()
  @IsNotEmpty()
  @MinLength(5)
  @MaxLength(100)
  @Matches(/^[A-ZÁÉÍÓÚ ().,]+$/, {
    message: 'La descripción frontal debe contener solo mayúsculas',
  })
  description: string

  @Field(() => Int, { description: 'level of the permisison', nullable: true })
  @IsInt()
  hierarchyLevel: number

  @Field({ nullable: true })
  @IsString()
  @IsOptional()
  parentId?: string;

  @Field({ nullable: true })
  @IsBoolean()
  @IsOptional()
  isSystem?: boolean;

  @Field(() => [String])
  @IsArray()
  @IsNotEmpty()
  permissionIds: string[];

  @IsOptional()
  @Field(() => GraphQLJSON, { description: 'Stores dynamic rules (e.g., access schedules, usage limits).' })
  metadata?: Record<string, any>;
}
