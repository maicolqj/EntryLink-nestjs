import { ObjectType, Field, Int } from '@nestjs/graphql';

import { ComplexDocument } from '../entities/complex-document.entity';
import { ComplexContact } from '../entities/complex-contact.entity';

/** Lo que el residente ve del conjunto: sus datos de contacto públicos. */
@ObjectType({ description: 'Datos generales del conjunto para el residente' })
export class ComplexPublicInfo {
  @Field()
  id: string;

  @Field()
  name: string;

  @Field(() => String, { nullable: true })
  description?: string | null;

  @Field(() => String, { nullable: true })
  address?: string | null;

  @Field(() => String, { nullable: true })
  city?: string | null;

  @Field(() => String, { nullable: true })
  state?: string | null;

  @Field(() => String, { nullable: true })
  phoneNumber?: string | null;

  @Field(() => String, { nullable: true })
  email?: string | null;

  @Field(() => String, { nullable: true })
  website?: string | null;

  @Field(() => String, { nullable: true, description: 'NIT de la copropiedad' })
  nit?: string | null;

  @Field(() => String, { nullable: true })
  logoUrl?: string | null;
}

/** Qué botones de acción rápida muestra la app en "Mi Conjunto". */
@ObjectType({
  description: 'Botones de Mi Conjunto que eligió la administración',
})
export class ComplexInfoSettings {
  @Field()
  showCall: boolean;

  @Field()
  showEmail: boolean;

  @Field()
  showDirections: boolean;

  @Field()
  showWebsite: boolean;
}

/** Un documento tal como lo ve un residente: con su acuse, si lo pide. */
@ObjectType()
export class MyComplexDocument {
  @Field(() => ComplexDocument)
  document: ComplexDocument;

  @Field(() => Date, {
    nullable: true,
    description:
      'Cuándo confirmó haber leído la versión VIGENTE; null = pendiente',
  })
  acknowledgedAt?: Date | null;

  @Field({ description: 'Tiene texto para leer en la app' })
  hasContent: boolean;

  @Field({ description: 'Tiene PDF adjunto' })
  hasFile: boolean;
}

@ObjectType({ description: 'Mi Conjunto: datos, contactos y documentos' })
export class MyComplexInfoResponse {
  @Field(() => ComplexPublicInfo)
  complex: ComplexPublicInfo;

  @Field(() => ComplexInfoSettings)
  settings: ComplexInfoSettings;

  @Field(() => [ComplexContact])
  contacts: ComplexContact[];

  @Field(() => [MyComplexDocument], {
    description:
      'Publicados y dirigidos a él; sin el texto (usar myComplexDocument)',
  })
  documents: MyComplexDocument[];

  @Field(() => Int, {
    description: 'Documentos que piden acuse y el residente no ha confirmado',
  })
  pendingAcknowledgements: number;
}

@ObjectType()
export class ComplexDocumentAckEntry {
  @Field()
  unitId: string;

  @Field({ description: 'Ej: "Torre 2 - 504"' })
  unitLabel: string;

  @Field(() => String, { nullable: true })
  residentName?: string | null;

  @Field(() => Date, { nullable: true, description: 'null = no ha confirmado' })
  acknowledgedAt?: Date | null;
}

/** Quién confirmó la versión vigente, contado por unidad. */
@ObjectType({ description: 'Acuses de lectura de la versión vigente' })
export class ComplexDocumentAckReport {
  @Field()
  documentId: string;

  @Field(() => Int)
  version: number;

  @Field(() => Int, { description: 'Unidades a las que va dirigido' })
  totalUnits: number;

  @Field(() => Int)
  acknowledgedUnits: number;

  @Field(() => [ComplexDocumentAckEntry], {
    description: 'Una fila por unidad: primero las pendientes',
  })
  units: ComplexDocumentAckEntry[];
}
