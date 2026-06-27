/**
 * Contrato AUTOCONTENIDO del campo `metadata` de las notificaciones.
 *
 * Copiar/compartir tal cual con el frontend: no importa nada del backend, por
 * lo que se puede pegar en cualquier proyecto TS.
 *
 * Canales de entrega (todos llevan el mismo `metadata`):
 *  - Socket en tiempo real (`notification:new`) → objeto JS.
 *  - Web Push → objeto JS en `data.metadata`.
 *  - FCM (móvil) → string JSON en `data.metadata` (hacer `JSON.parse`).
 *
 * Mantener sincronizado con:
 *   src/modules/notifications/interfaces/notification-metadata.interface.ts
 */

/** Tipos de notificación con metadata tipada en este contrato. */
export type TypedNotificationType = 'WALLET_APPLIED' | 'WALLET_CREDIT';

/** Campos comunes a las notificaciones por unidad. */
export interface UnitScopedMetadata {
  unitId: string;
  complexId: string;
}

/** WALLET_APPLIED — Saldo a favor (anticipo) aplicado a cargos de una unidad. */
export interface WalletAppliedMetadata extends UnitScopedMetadata {
  /** Monto aplicado del saldo a favor, en COP. */
  amount: number;
  /**
   * Cargo concreto al que se aplicó cuando fue sobre un único cargo
   * (`applyWalletToCharge`). En la aplicación masiva por prelación
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

/** Mapa tipo de notificación → shape de su `metadata`. */
export interface NotificationMetadataByType {
  WALLET_APPLIED: WalletAppliedMetadata;
  WALLET_CREDIT: WalletCreditMetadata;
}

/** Metadata tipada para un tipo dado (fallback genérico para los no listados). */
export type NotificationMetadata<T extends string> =
  T extends keyof NotificationMetadataByType
    ? NotificationMetadataByType[T]
    : Record<string, unknown>;
