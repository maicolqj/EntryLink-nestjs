import { Field, InputType, Int, ObjectType } from '@nestjs/graphql';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';
import GraphQLJSON from 'graphql-type-json';

import { DeviceType } from '../enums/device-type.enum';
import { Device } from '../entities/device.iot-entity';
import { PlanterReading } from '../entities/planter-reading.iot-entity';
import { DeviceNotificationType } from '../entities/device-notification-type.iot-entity';

// ─────────────────────────── Inputs ───────────────────────────

@InputType()
export class CreateIotDeviceInput {
  @Field(() => DeviceType)
  @IsEnum(DeviceType)
  type: DeviceType;

  @Field(() => String)
  @IsUUID()
  complexId: string;
}

@InputType()
export class DeviceNotificationPrefInput {
  @Field(() => String)
  @IsString()
  @MaxLength(32)
  typeKey: string;

  @Field(() => Boolean)
  @IsBoolean()
  enabled: boolean;
}

@InputType()
export class StartDeviceOtaInput {
  /** uuid o deviceId público. */
  @Field(() => String)
  @IsString()
  @MaxLength(40)
  deviceId: string;

  @Field(() => String)
  @IsString()
  @MaxLength(250)
  url: string;

  @Field(() => String)
  @Matches(/^[0-9a-fA-F]{64}$/, {
    message: 'sha256 debe tener 64 caracteres hex',
  })
  sha256: string;

  @Field(() => String)
  @IsString()
  @Length(1, 15)
  version: string;
}

@InputType()
export class UpdateDeviceConfigInput {
  @Field(() => String)
  @IsString()
  @MaxLength(40)
  deviceId: string;

  /** { whatsappEnabled?, notifyComplexAdmins?, quietHours?: { start, end, timeZone? } | null } */
  @Field(() => GraphQLJSON)
  config: Record<string, unknown>;
}

@InputType()
export class FactoryResetDeviceInput {
  @Field(() => String)
  @IsString()
  @MaxLength(40)
  deviceId: string;

  /** También borra la calibración (servicio técnico). Por defecto se conserva. */
  @Field(() => Boolean, { nullable: true, defaultValue: false })
  @IsOptional()
  @IsBoolean()
  wipeCalibration?: boolean;
}

// ─────────────────────────── Respuestas ───────────────────────────

@ObjectType('CreatedIotDevice', {
  description: 'Alta de un dispositivo. deviceKey se muestra UNA sola vez',
})
export class CreatedIotDeviceResponse {
  @Field(() => Device)
  device: Device;

  @Field(() => String, {
    description:
      'Secreto del aparato: grábalo con flash_identity.py y no lo guardes',
  })
  deviceKey: string;

  @Field(() => String)
  pairingCode: string;

  @Field(() => String, {
    description: 'deviceId,deviceKey,type,complexId,pairingCode',
  })
  csvLine: string;
}

@ObjectType('PlanterReadingsPage')
export class PlanterReadingsPage {
  @Field(() => [PlanterReading])
  items: PlanterReading[];

  @Field(() => Int)
  total: number;
}

@ObjectType('DeviceNotificationTypeView')
export class DeviceNotificationTypeView extends DeviceNotificationType {
  @Field(() => Boolean, {
    description:
      'Obligatorio por catálogo o por la administración del conjunto',
  })
  effectiveMandatory: boolean;
}

@ObjectType('DeviceNotificationPrefView')
export class DeviceNotificationPrefView {
  @Field(() => String)
  typeKey: string;

  @Field(() => Boolean)
  enabled: boolean;

  @Field(() => Boolean)
  mandatory: boolean;
}

@ObjectType('PlantProfileView')
export class PlantProfileView {
  @Field(() => String)
  plantId: string;

  @Field(() => String)
  nombre: string;

  @Field(() => GraphQLJSON)
  thresholds: Record<string, number>;
}
