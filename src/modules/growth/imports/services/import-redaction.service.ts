import { Injectable } from '@nestjs/common';
import { SuppressionsService } from '../../compliance/services/suppressions.service';
import { GrowthIdentifierType } from '../../shared/growth.enums';
import { normalizeIdentifier } from '../../shared/identifier-normalizer';
import { REDACTED } from '../shared/redaction';

const EMAIL_TOKEN =
  /[^\s@;,:<>()[\]"']+@[^\s@;,:<>()[\]"']+\.[^\s@;,:<>()[\]"']+/g;
const PHONE_TOKEN = /\+?\d[\d\s().-]{5,}\d/g;

/**
 * Redacta en las filas crudas todo correo o teléfono que esté en la lista de
 * exclusión, en cualquier celda (mapeada o no, sola o dentro de un texto).
 * Corre ANTES de guardar las filas al subir el archivo, y otra vez al validar
 * por si la lista cambió en medio: el dato excluido no llega a la base.
 */
@Injectable()
export class ImportRedactionService {
  constructor(private readonly suppressions: SuppressionsService) {}

  /** Redacta en el lugar. Devuelve cuántos valores reemplazó. */
  async redact(rows: string[][]): Promise<number> {
    const emails: string[] = [];
    const phones: string[] = [];
    for (const row of rows) {
      for (const cell of row) {
        if (!cell) continue;
        for (const t of cell.match(EMAIL_TOKEN) ?? []) emails.push(t);
        for (const t of cell.match(PHONE_TOKEN) ?? []) {
          if (normalizeIdentifier(GrowthIdentifierType.PHONE, t))
            phones.push(t);
        }
      }
    }
    const blocked = new Set<string>([
      ...(await this.suppressions.suppressedAmong(
        GrowthIdentifierType.EMAIL,
        emails,
      )),
      ...(await this.suppressions.suppressedAmong(
        GrowthIdentifierType.PHONE,
        phones,
      )),
    ]);
    if (!blocked.size) return 0;

    let count = 0;
    for (const row of rows) {
      for (let i = 0; i < row.length; i++) {
        const cell = row[i];
        if (!cell) continue;
        const replaced = cell
          .replace(EMAIL_TOKEN, (t) =>
            blocked.has(t) ? (count++, REDACTED) : t,
          )
          .replace(PHONE_TOKEN, (t) =>
            blocked.has(t) ? (count++, REDACTED) : t,
          );
        row[i] = replaced;
      }
    }
    return count;
  }
}
