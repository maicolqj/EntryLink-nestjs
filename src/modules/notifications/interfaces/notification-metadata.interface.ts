import { NotificationType } from '../enums/notification-type.enum';

/**
 * Contrato tipado del campo `metadata` de cada notificación.
 *
 * `metadata` viaja por los 3 canales de entrega:
 *  - Socket en tiempo real (`notification:new`) → objeto JS tal cual.
 *  - Web Push → objeto JS dentro de `data.metadata`.
 *  - FCM (móvil) → SIEMPRE serializado como string JSON en `data.metadata`
 *    (FCM exige valores string); el cliente debe hacer `JSON.parse`.
 *
 * Mantener este archivo como única fuente de verdad del shape y compartirlo
 * con el frontend.
 */

/** Campos comunes a casi todas las notificaciones de finanzas (por unidad). */
export interface UnitScopedMetadata {
  unitId: string;
  complexId: string;
}

/** WALLET_APPLIED — Saldo a favor (anticipo) aplicado a cargos de una unidad. */
export interface WalletAppliedMetadata extends UnitScopedMetadata {
  /** Monto aplicado del saldo a favor, en COP. */
  amount: number;
  /**
   * Cargo concreto al que se aplicó, cuando la aplicación fue sobre un único
   * cargo (`applyWalletToCharge`). En la aplicación masiva por prelación
   * (`applyPrepaidBalances`) es `null` porque cubre varios cargos.
   */
  chargeId?: string | null;
}

/** WALLET_CREDIT — Saldo a favor agregado a una unidad. */
export interface WalletCreditMetadata extends UnitScopedMetadata {
  /** Monto acreditado, en COP. */
  amount: number;
  /** Concepto del crédito. */
  description: string;
}

/**
 * Mapa tipo de notificación → shape de su `metadata`.
 * Extender a medida que se tipen más eventos. Los tipos no listados usan el
 * fallback genérico `Record<string, unknown>`.
 */
export interface NotificationMetadataByType {
  [NotificationType.WALLET_APPLIED]: WalletAppliedMetadata;
  [NotificationType.WALLET_CREDIT]: WalletCreditMetadata;
}

/** Metadata tipada para un `NotificationType` dado (con fallback genérico). */
export type NotificationMetadata<T extends NotificationType> =
  T extends keyof NotificationMetadataByType
    ? NotificationMetadataByType[T]
    : Record<string, unknown>;
