import {
  HttpStatus,
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';

import { CustomError } from '../../shared/utils/errors.utils';
import {
  ComplexErrorCode,
  DeviceManagementErrorCode,
} from '../../shared/constans/error-codes.constants';
import { ResidentialComplex } from '../../residential-complex/entities/residential-complex.entity';
import { ManagedEnterprise } from '../entities/managed-enterprise.entity';
import {
  AmapiDevice,
  AndroidManagementClient,
} from './android-management.client';
import {
  ENTRYLINK_PACKAGE,
  KIOSK_POLICY_ID,
  buildKioskPolicy,
  kioskPolicyHash,
} from '../kiosk-policy';
import {
  DeviceEnrollmentQr,
  DeviceManagementStatus,
  EnterpriseSignup,
  ManagedDevice,
  ManagedDeviceCommand,
} from '../dto/device-management.dto';

/** Vigencia del QR: alcanza para instalar varios equipos el mismo día. */
const ENROLLMENT_TOKEN_TTL_SECONDS = 24 * 60 * 60;

@Injectable()
export class DeviceManagementService implements OnApplicationBootstrap {
  private readonly logger = new Logger(DeviceManagementService.name);

  constructor(
    private readonly amapi: AndroidManagementClient,
    private readonly config: ConfigService,
    @InjectRepository(ManagedEnterprise)
    private readonly enterpriseRepo: Repository<ManagedEnterprise>,
    @InjectRepository(ResidentialComplex)
    private readonly complexRepo: Repository<ResidentialComplex>,
  ) {}

  /**
   * Si la política del código cambió desde la última vez, se aplica sola al
   * desplegar. Sin esto, un ajuste a la política quedaría solo en el código
   * hasta que alguien se acordara de apretar el botón.
   *
   * No se espera: arrancar el API no puede depender de que Google responda.
   */
  onApplicationBootstrap(): void {
    if (!this.amapi.configured) return;
    void this.findEnterprise()
      .then((enterprise) => {
        if (enterprise && enterprise.policyHash !== kioskPolicyHash()) {
          return this.applyPolicyTo(enterprise);
        }
      })
      .catch((e: Error) =>
        this.logger.error(`No se pudo reaplicar la política de kiosco: ${e.message}`),
      );
  }

  async status(): Promise<DeviceManagementStatus> {
    const enterprise = await this.findEnterprise();
    return {
      configured: this.amapi.configured,
      enterpriseName: enterprise?.name ?? null,
      enterpriseDisplayName: enterprise?.displayName ?? null,
      policyAppliedAt: enterprise?.policyAppliedAt ?? null,
      policyUpToDate: !!enterprise && enterprise.policyHash === kioskPolicyHash(),
    };
  }

  /**
   * Paso 1 del registro: Google da un enlace donde se inicia sesión con la
   * cuenta de Google que será dueña de la empresa. Al terminar, Google vuelve
   * a `callbackUrl` con `?enterpriseToken=…`.
   */
  async startSignup(callbackUrl: string): Promise<EnterpriseSignup> {
    await this.assertNoEnterprise();
    this.assertAllowedCallback(callbackUrl);
    const signup = await this.amapi.createSignupUrl(callbackUrl);
    return { signupUrlName: signup.name, url: signup.url };
  }

  /** Paso 2: con el token que trajo Google se crea la empresa y se le aplica la política. */
  async completeSignup(
    signupUrlName: string,
    enterpriseToken: string,
    userId: string,
  ): Promise<DeviceManagementStatus> {
    await this.assertNoEnterprise();
    const created = await this.amapi.createEnterprise(signupUrlName, enterpriseToken);
    const enterprise = await this.enterpriseRepo.save(
      this.enterpriseRepo.create({
        name: created.name,
        displayName: created.enterpriseDisplayName ?? null,
        createdById: userId,
      }),
    );
    this.logger.log(`Empresa de Android Management vinculada: ${enterprise.name}`);
    await this.applyPolicyTo(enterprise);
    return this.status();
  }

  async applyPolicy(): Promise<DeviceManagementStatus> {
    await this.applyPolicyTo(await this.requireEnterprise());
    return this.status();
  }

  /**
   * QR para inscribir un equipo de un conjunto. El `complexId` viaja en el
   * token y Google lo devuelve en cada equipo: así se sabe de qué conjunto es
   * sin guardar nada propio.
   *
   * Inscribir no da acceso a nada: el equipo solo abre EntryLink, y ahí el
   * guarda igual tiene que iniciar sesión.
   */
  async createEnrollmentQr(complexId: string): Promise<DeviceEnrollmentQr> {
    const enterprise = await this.requireEnterprise();
    const complex = await this.complexRepo.findOne({
      where: { id: complexId, deletedAt: IsNull() },
      select: { id: true, name: true },
    });
    if (!complex) {
      throw new CustomError({
        message: 'El conjunto no existe',
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: ComplexErrorCode.COMPLEX_NOT_FOUND,
      });
    }

    const token = await this.amapi.createEnrollmentToken(enterprise.name, {
      policyName: this.policyName(enterprise),
      duration: `${ENROLLMENT_TOKEN_TTL_SECONDS}s`,
      additionalData: complex.id,
      allowPersonalUsage: 'PERSONAL_USAGE_DISALLOWED',
      oneTimeOnly: false,
    });

    return {
      qrCode: token.qrCode,
      enrollmentCode: token.value,
      expiresAt: new Date(token.expirationTimestamp),
      complexId: complex.id,
      complexName: complex.name,
    };
  }

  async devices(complexId?: string | null): Promise<ManagedDevice[]> {
    const enterprise = await this.requireEnterprise();
    const all = await this.amapi.listDevices(enterprise.name);
    const filtered = complexId
      ? all.filter((d) => d.enrollmentTokenData === complexId)
      : all;

    const complexIds = [
      ...new Set(filtered.map((d) => d.enrollmentTokenData).filter(Boolean)),
    ] as string[];
    const complexes = complexIds.length
      ? await this.complexRepo.find({
          where: { id: In(complexIds) },
          select: { id: true, name: true },
        })
      : [];
    const names = new Map(complexes.map((c) => [c.id, c.name]));

    return filtered.map((d) => toManagedDevice(d, names));
  }

  async command(deviceName: string, command: ManagedDeviceCommand): Promise<boolean> {
    await this.assertOwnDevice(deviceName);
    await this.amapi.issueCommand(deviceName, command);
    this.logger.log(`Orden ${command} enviada a ${deviceName}`);
    return true;
  }

  /**
   * Retira el equipo: Google le borra todo y lo deja de fábrica. Es la única
   * forma de sacar a un equipo del modo kiosco.
   */
  async release(deviceName: string): Promise<boolean> {
    await this.assertOwnDevice(deviceName);
    await this.amapi.deleteDevice(deviceName);
    this.logger.warn(`Equipo retirado (borrado de fábrica): ${deviceName}`);
    return true;
  }

  // ── Internos ──────────────────────────────────────────────────────────────

  private async applyPolicyTo(enterprise: ManagedEnterprise): Promise<void> {
    await this.amapi.patchPolicy(this.policyName(enterprise), buildKioskPolicy());
    enterprise.policyHash = kioskPolicyHash();
    enterprise.policyAppliedAt = new Date();
    await this.enterpriseRepo.save(enterprise);
    this.logger.log(`Política de kiosco aplicada en ${enterprise.name}`);
  }

  private policyName(enterprise: ManagedEnterprise): string {
    return `${enterprise.name}/policies/${KIOSK_POLICY_ID}`;
  }

  private findEnterprise(): Promise<ManagedEnterprise | null> {
    return this.enterpriseRepo.findOne({ where: {}, order: { createdAt: 'ASC' } });
  }

  private async requireEnterprise(): Promise<ManagedEnterprise> {
    const enterprise = await this.findEnterprise();
    if (!enterprise) {
      throw new CustomError({
        message: 'Primero hay que vincular la cuenta de Google de la empresa',
        statusCode: HttpStatus.PRECONDITION_FAILED,
        errorCode: DeviceManagementErrorCode.DEVICE_MANAGEMENT_NO_ENTERPRISE,
      });
    }
    return enterprise;
  }

  private async assertNoEnterprise(): Promise<void> {
    if (await this.findEnterprise()) {
      throw new CustomError({
        message:
          'Ya hay una empresa vinculada. Crear otra dejaría por fuera a los equipos ya inscritos.',
        statusCode: HttpStatus.CONFLICT,
        errorCode: DeviceManagementErrorCode.DEVICE_MANAGEMENT_ENTERPRISE_EXISTS,
      });
    }
  }

  /** Google redirige con el token a esta URL: solo a los dominios del panel. */
  private assertAllowedCallback(callbackUrl: string): void {
    const allowed = (this.config.get<string>('ALLOWED_ORIGINS') ?? '')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean);
    let origin: string;
    try {
      origin = new URL(callbackUrl).origin;
    } catch {
      origin = '';
    }
    if (!allowed.includes(origin)) {
      throw new CustomError({
        message: 'La URL de regreso no pertenece a un dominio permitido',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: DeviceManagementErrorCode.DEVICE_MANAGEMENT_INVALID_CALLBACK,
      });
    }
  }

  /** Solo equipos de la empresa propia: el nombre llega del cliente. */
  private async assertOwnDevice(deviceName: string): Promise<void> {
    const enterprise = await this.requireEnterprise();
    const prefix = `${enterprise.name}/devices/`;
    const id = deviceName.startsWith(prefix) ? deviceName.slice(prefix.length) : '';
    if (!id || !/^[\w-]+$/.test(id)) {
      throw new CustomError({
        message: 'El equipo no pertenece a esta empresa',
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: DeviceManagementErrorCode.DEVICE_MANAGEMENT_DEVICE_NOT_FOUND,
      });
    }
  }
}

export function toManagedDevice(
  d: AmapiDevice,
  complexNames: Map<string, string>,
): ManagedDevice {
  const app = d.applicationReports?.find((r) => r.packageName === ENTRYLINK_PACKAGE);
  const complexId = d.enrollmentTokenData || null;
  return {
    name: d.name,
    state: d.state ?? null,
    brand: d.hardwareInfo?.brand ?? null,
    model: d.hardwareInfo?.model ?? null,
    serialNumber: d.hardwareInfo?.serialNumber ?? null,
    androidVersion: d.softwareInfo?.androidVersion ?? null,
    appVersionName: app?.versionName ?? null,
    appVersionCode: app?.versionCode ?? null,
    complexId,
    complexName: complexId ? (complexNames.get(complexId) ?? null) : null,
    enrollmentTime: d.enrollmentTime ? new Date(d.enrollmentTime) : null,
    lastStatusReportTime: d.lastStatusReportTime ? new Date(d.lastStatusReportTime) : null,
    policyCompliant: d.policyCompliant ?? null,
    nonCompliance: (d.nonComplianceDetails ?? []).map(
      (n) => `${n.settingName ?? '?'}: ${n.nonComplianceReason ?? '?'}`,
    ),
  };
}
