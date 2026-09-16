import { InputType, Field } from '@nestjs/graphql';
import GraphQLJSON from 'graphql-type-json';
import { IsObject, IsOptional, IsString, IsUUID, Matches } from 'class-validator';

/**
 * Ejecutar, desde el aviso, una de las acciones que el propio expediente
 * declaró.
 *
 * `values` es JSON y no un input tipado a propósito: los campos los declara
 * cada módulo (una multa pide valor y motivación; aprobar una ficha pide notas)
 * y tiparlos aquí obligaría a tocar el esquema —y a resincronizar el manifiesto
 * de la web— cada vez que un módulo agrega una acción. Lo que se pierde en
 * validación de forma se recupera donde importa: el proveedor ejecuta contra el
 * servicio del módulo, que valida con sus propias reglas.
 */
@InputType()
export class ExecuteNotificationActionInput {
  @Field(() => String)
  @IsUUID()
  notificationId: string;

  /** Código declarado en `entity.actions[].code`: `PET_INCIDENT_FINE`. */
  @Field(() => String)
  @IsString()
  @Matches(/^[A-Z][A-Z0-9_]{2,63}$/, {
    message: 'El código de la acción no tiene un formato válido',
  })
  actionCode: string;

  @Field(() => GraphQLJSON, {
    nullable: true,
    description: 'Respuestas a los campos que pide la acción',
  })
  @IsOptional()
  @IsObject()
  values?: Record<string, unknown>;

  /** Necesario para SUPER_ADMIN, que no está atado a un solo complejo. */
  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsUUID()
  complexId?: string;
}
