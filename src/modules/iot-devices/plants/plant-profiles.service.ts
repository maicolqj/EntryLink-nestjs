import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { readFileSync } from 'node:fs';

import type { PlantProfile } from '../entities/device.iot-entity';

/** Umbrales que exige el firmware en set_plant (si falta uno responde missing_thresholds). */
export const PLANT_THRESHOLD_KEYS = [
  'suelo_sed',
  'suelo_ideal_min',
  'suelo_ideal_max',
  'suelo_exceso',
  'lux_min',
  'lux_max',
  'temp_min',
  'temp_max',
  'hr_min',
  'hr_max',
] as const;

/**
 * Catálogo mínimo incluido: solo el Potus del prompt de la Fase 4. El de las
 * 60 especies se carga con IOT_PLANT_CATALOG=<ruta a plantas_perfiles.json>
 * (lista, o { "plantas": [...] }, mismo formato que tools/ del firmware).
 */
const CATALOGO_BASE: PlantProfile[] = [
  {
    plantId: 'epipremnum-aureum',
    nombre: 'Potus',
    thresholds: {
      suelo_sed: 30,
      suelo_ideal_min: 40,
      suelo_ideal_max: 60,
      suelo_exceso: 75,
      lux_min: 1000,
      lux_max: 10000,
      temp_min: 18,
      temp_max: 29,
      hr_min: 40,
      hr_max: 70,
    },
  },
];

@Injectable()
export class PlantProfilesService implements OnModuleInit {
  private readonly logger = new Logger(PlantProfilesService.name);
  private catalogo = new Map<string, PlantProfile>();

  onModuleInit(): void {
    let filas: unknown[] = CATALOGO_BASE;
    const ruta = process.env.IOT_PLANT_CATALOG;
    if (ruta) {
      try {
        const json = JSON.parse(readFileSync(ruta, 'utf8')) as unknown;
        filas = Array.isArray(json)
          ? json
          : ((json as { plantas?: unknown[] } | null)?.plantas ?? []);
      } catch (e) {
        this.logger.error(
          `IOT_PLANT_CATALOG ilegible (${ruta}): ${e instanceof Error ? e.message : e}. Uso el básico`,
        );
      }
    }
    for (const fila of filas) {
      const p = this.validar(fila);
      if (p) this.catalogo.set(p.plantId, p);
    }
    this.logger.log(`Catálogo de plantas: ${this.catalogo.size} especies`);
  }

  list(): PlantProfile[] {
    return [...this.catalogo.values()].sort((a, b) =>
      a.nombre.localeCompare(b.nombre, 'es'),
    );
  }

  get(plantId: string): PlantProfile {
    const p = this.catalogo.get(plantId);
    if (!p)
      throw new NotFoundException(
        `La planta "${plantId}" no está en el catálogo`,
      );
    return p;
  }

  /** Solo pasa al catálogo lo que el firmware aceptaría. */
  private validar(fila: unknown): PlantProfile | null {
    const f = fila as Partial<PlantProfile> | null;
    if (!f?.plantId || typeof f.plantId !== 'string' || f.plantId.length >= 40)
      return null;
    const t = f.thresholds ?? {};
    const thresholds: Record<string, number> = {};
    for (const k of PLANT_THRESHOLD_KEYS) {
      if (typeof t[k] !== 'number' || !Number.isFinite(t[k])) return null;
      thresholds[k] = t[k];
    }
    // El firmware guarda el id en 40 bytes y el nombre en 32 (con el 0 final)
    return {
      plantId: f.plantId,
      nombre: String(f.nombre ?? f.plantId).slice(0, 31),
      thresholds,
    };
  }
}
