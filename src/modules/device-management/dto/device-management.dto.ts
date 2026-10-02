import {
  Field,
  InputType,
  Int,
  ObjectType,
  registerEnumType,
} from '@nestjs/graphql';
import { IsEnum, IsNotEmpty, IsString, IsUrl, MaxLength } from 'class-validator';

export enum ManagedDeviceCommand {
  REBOOT = 'REBOOT',
  LOCK = 'LOCK',
}

registerEnumType(ManagedDeviceCommand, {
  name: 'ManagedDeviceCommand',
  description: 'Órdenes remotas a un equipo de portería',
});

@ObjectType({ description: 'Estado de la administración de equipos de portería' })
export class DeviceManagementStatus {
  @Field(() => Boolean, {
    description: 'false = faltan las credenciales de Google en el servidor',
  })
  configured: boolean;

  @Field(() => String, {
    nullable: true,
    description: 'Empresa vinculada (enterprises/…); vacío = falta vincularla',
  })
  enterpriseName?: string | null;

  @Field(() => String, { nullable: true })
  enterpriseDisplayName?: string | null;

  @Field(() => Date, { nullable: true })
  policyAppliedAt?: Date | null;

  @Field(() => Boolean, {
    description: 'false = la política de kiosco del código no es la que tiene Google',
  })
  policyUpToDate: boolean;
}

@ObjectType({ description: 'Enlace para vincular la cuenta de Google de la empresa' })
export class EnterpriseSignup {
  @Field(() => String, {
    description: 'Guardarlo: se necesita para terminar el registro al volver',
  })
  signupUrlName: string;

  @Field(() => String, { description: 'Abrir en el navegador' })
  url: string;
}

@InputType()
export class StartEnterpriseSignupInput {
  @Field(() => String, {
    description:
      'Página del panel a la que Google regresa con ?enterpriseToken=…; debe ser de un dominio permitido',
  })
  @IsUrl({ require_tld: false, protocols: ['http', 'https'] })
  @MaxLength(500)
  callbackUrl: string;
}

@InputType()
export class CompleteEnterpriseSignupInput {
  @Field(() => String)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  signupUrlName: string;

  @Field(() => String)
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  enterpriseToken: string;
}

@ObjectType({ description: 'QR para inscribir un equipo de portería de un conjunto' })
export class DeviceEnrollmentQr {
  @Field(() => String, {
    description:
      'Contenido del QR (JSON): se escanea en un equipo recién reseteado tocando 6 veces la pantalla de bienvenida',
  })
  qrCode: string;

  @Field(() => String, {
    description: 'Código para inscribir sin QR (afw#setup o el campo de código)',
  })
  enrollmentCode: string;

  @Field(() => Date)
  expiresAt: Date;

  @Field(() => String)
  complexId: string;

  @Field(() => String)
  complexName: string;
}

@ObjectType({ description: 'Equipo de portería inscrito' })
export class ManagedDevice {
  @Field(() => String, { description: 'enterprises/…/devices/…' })
  name: string;

  @Field(() => String, { nullable: true, description: 'ACTIVE, PROVISIONING, DISABLED, LOST…' })
  state?: string | null;

  @Field(() => String, { nullable: true })
  brand?: string | null;

  @Field(() => String, { nullable: true })
  model?: string | null;

  @Field(() => String, { nullable: true })
  serialNumber?: string | null;

  @Field(() => String, { nullable: true })
  androidVersion?: string | null;

  @Field(() => String, { nullable: true, description: 'Versión de EntryLink instalada' })
  appVersionName?: string | null;

  @Field(() => Int, { nullable: true })
  appVersionCode?: number | null;

  @Field(() => String, { nullable: true, description: 'Conjunto del QR con que se inscribió' })
  complexId?: string | null;

  @Field(() => String, { nullable: true })
  complexName?: string | null;

  @Field(() => Date, { nullable: true })
  enrollmentTime?: Date | null;

  @Field(() => Date, { nullable: true, description: 'Último reporte del equipo' })
  lastStatusReportTime?: Date | null;

  @Field(() => Boolean, { nullable: true })
  policyCompliant?: boolean | null;

  @Field(() => [String], {
    description: 'Ajustes de la política que el equipo no pudo cumplir (campo: motivo)',
  })
  nonCompliance: string[];
}

@InputType()
export class ManagedDeviceCommandInput {
  @Field(() => String)
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  deviceName: string;

  @Field(() => ManagedDeviceCommand)
  @IsEnum(ManagedDeviceCommand)
  command: ManagedDeviceCommand;
}
