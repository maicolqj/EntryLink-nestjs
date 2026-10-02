import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JWT } from 'google-auth-library';

import { CustomError } from '../../shared/utils/errors.utils';
import { DeviceManagementErrorCode } from '../../shared/constans/error-codes.constants';

const BASE_URL = 'https://androidmanagement.googleapis.com/v1';
const SCOPE = 'https://www.googleapis.com/auth/androidmanagement';
const PEM_HEADER = '-----BEGIN PRIVATE KEY-----';

/** Respuestas de Google que se usan aquí (solo los campos que se leen). */
export interface AmapiSignupUrl {
  name: string;
  url: string;
}

export interface AmapiEnterprise {
  name: string;
  enterpriseDisplayName?: string;
}

export interface AmapiEnrollmentToken {
  name: string;
  value: string;
  qrCode: string;
  expirationTimestamp: string;
}

export interface AmapiDevice {
  name: string;
  state?: string;
  appliedState?: string;
  enrollmentTime?: string;
  lastStatusReportTime?: string;
  lastPolicySyncTime?: string;
  enrollmentTokenData?: string;
  policyCompliant?: boolean;
  nonComplianceDetails?: { settingName?: string; nonComplianceReason?: string }[];
  hardwareInfo?: { brand?: string; model?: string; serialNumber?: string };
  softwareInfo?: { androidVersion?: string };
  applicationReports?: { packageName?: string; versionName?: string; versionCode?: number }[];
}

/**
 * Cliente mínimo de Android Management API (REST). No se usa `googleapis`:
 * pesa decenas de MB para cinco llamadas.
 *
 * Credenciales: una cuenta de servicio del proyecto de Google Cloud donde está
 * habilitada la API, con el rol "Android Management User". Se leen de
 * ANDROID_MANAGEMENT_* y, si no están, de FIREBASE_* —el proyecto de Firebase
 * ya es un proyecto de Cloud y su cuenta de servicio sirve si se le da el rol—.
 */
@Injectable()
export class AndroidManagementClient {
  private readonly logger = new Logger(AndroidManagementClient.name);
  private readonly client: JWT | null;
  readonly projectId: string | null;

  constructor(config: ConfigService) {
    const pick = (suffix: string) =>
      config.get<string>(`ANDROID_MANAGEMENT_${suffix}`)?.trim() ||
      config.get<string>(`FIREBASE_${suffix}`)?.trim() ||
      undefined;

    const projectId = pick('PROJECT_ID');
    const clientEmail = pick('CLIENT_EMAIL');
    const privateKey = this.resolvePrivateKey(config);

    if (!projectId || !clientEmail || !privateKey) {
      this.logger.warn(
        'Android Management sin credenciales — la administración de equipos de portería queda deshabilitada.',
      );
      this.client = null;
      this.projectId = null;
      return;
    }

    this.projectId = projectId;
    this.client = new JWT({ email: clientEmail, key: privateKey, scopes: [SCOPE] });
  }

  get configured(): boolean {
    return this.client !== null;
  }

  createSignupUrl(callbackUrl: string): Promise<AmapiSignupUrl> {
    return this.call('POST', '/signupUrls', {
      params: { projectId: this.projectId, callbackUrl },
    });
  }

  createEnterprise(signupUrlName: string, enterpriseToken: string): Promise<AmapiEnterprise> {
    return this.call('POST', '/enterprises', {
      params: { projectId: this.projectId, signupUrlName, enterpriseToken },
      data: {},
    });
  }

  patchPolicy(policyName: string, policy: Record<string, unknown>): Promise<unknown> {
    return this.call('PATCH', `/${policyName}`, { data: policy });
  }

  createEnrollmentToken(
    enterpriseName: string,
    body: Record<string, unknown>,
  ): Promise<AmapiEnrollmentToken> {
    return this.call('POST', `/${enterpriseName}/enrollmentTokens`, { data: body });
  }

  async listDevices(enterpriseName: string): Promise<AmapiDevice[]> {
    const devices: AmapiDevice[] = [];
    let pageToken: string | undefined;
    do {
      const page = await this.call<{ devices?: AmapiDevice[]; nextPageToken?: string }>(
        'GET',
        `/${enterpriseName}/devices`,
        { params: { pageSize: 100, pageToken } },
      );
      devices.push(...(page.devices ?? []));
      pageToken = page.nextPageToken;
    } while (pageToken);
    return devices;
  }

  getDevice(deviceName: string): Promise<AmapiDevice> {
    return this.call('GET', `/${deviceName}`);
  }

  issueCommand(deviceName: string, type: string): Promise<unknown> {
    return this.call('POST', `/${deviceName}:issueCommand`, { data: { type } });
  }

  deleteDevice(deviceName: string): Promise<unknown> {
    return this.call('DELETE', `/${deviceName}`);
  }

  private async call<T>(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    opts: { params?: Record<string, unknown>; data?: unknown } = {},
  ): Promise<T> {
    if (!this.client) {
      throw new CustomError({
        message:
          'La administración de equipos no está configurada en el servidor (faltan las credenciales de Google).',
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        errorCode: DeviceManagementErrorCode.DEVICE_MANAGEMENT_NOT_CONFIGURED,
      });
    }
    try {
      const res = await this.client.request<T>({
        url: `${BASE_URL}${path}`,
        method,
        params: opts.params,
        data: opts.data,
      });
      return res.data;
    } catch (e) {
      // El mensaje de Google dice qué campo o permiso falló; sin él, "400" no
      // le sirve a nadie para arreglarlo.
      const err = e as {
        message?: string;
        response?: { status?: number; data?: { error?: { message?: string } } };
      };
      const status = err.response?.status;
      const detail = err.response?.data?.error?.message ?? err.message;
      this.logger.error(`Android Management ${method} ${path} → ${status}: ${detail}`);
      throw new CustomError({
        message: `Google rechazó la operación: ${detail}`,
        statusCode:
          status === HttpStatus.NOT_FOUND ? HttpStatus.NOT_FOUND : HttpStatus.BAD_GATEWAY,
        errorCode: DeviceManagementErrorCode.DEVICE_MANAGEMENT_GOOGLE_ERROR,
      });
    }
  }

  /** Igual que Firebase: base64 primero (inmune al escapado de los paneles), luego PEM. */
  private resolvePrivateKey(config: ConfigService): string | undefined {
    for (const prefix of ['ANDROID_MANAGEMENT', 'FIREBASE']) {
      const base64 = config.get<string>(`${prefix}_PRIVATE_KEY_BASE64`)?.trim();
      if (base64) {
        const decoded = Buffer.from(base64, 'base64').toString('utf8');
        if (decoded.includes(PEM_HEADER)) return decoded;
      }
      const raw = config.get<string>(`${prefix}_PRIVATE_KEY`)?.trim();
      if (raw) return raw.replace(/^"|"$/g, '').replace(/\\n/g, '\n');
    }
    return undefined;
  }
}
