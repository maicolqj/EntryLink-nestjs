import { randomInt } from 'crypto';

/** Lo que el planificador necesita saber de cada vehículo. */
export interface RotationCandidate {
  id: string;
  parkingSpot?: string | null;
  suspendedByRotation: boolean;
  rotationCycleCount: number;
  rotationSuspendedAt?: Date | null;
}

export interface RotationPlan<T extends RotationCandidate> {
  /** Estaban fuera por rotación y vuelven a entrar. */
  reactivate: T[];
  /** Quedan fuera del parqueadero en esta rotación. */
  suspend: T[];
  /** Quedan dentro (incluye a los que vuelven). */
  inside: T[];
  /** Todos ya habían salido una vez: arranca un gran ciclo nuevo. */
  cycleCompleted: boolean;
  /** Número de cupo que queda para cada vehículo (null = sin cupo). */
  spotById: Map<string, string | null>;
}

/**
 * Decide una rotación de un tipo de vehículo, sin tocar nada.
 *
 * Es la misma regla para ejecutar la rotación y para mostrar quién saldría en
 * la próxima: si fueran dos cálculos, el informe podría anunciar a alguien que
 * después no sale.
 *
 * 1. Los que están fuera vuelven a entrar.
 * 2. Si todos ya salieron al menos una vez, se reinicia el conteo (gran ciclo).
 * 3. Salen los `pool - cupos` con menos salidas; a igualdad, el que salió hace
 *    más tiempo (o nunca). Nadie repite hasta que todos hayan salido.
 * 4. Los números de cupo de todo el grupo se revuelven al azar entre los que
 *    quedan dentro; el que sale queda sin número, porque está fuera del
 *    conjunto. No hace falta una lista de cupos físicos: los números son los
 *    que ya tenían asignados los vehículos.
 *
 * Devuelve null si no sobra ningún vehículo: no hay nada que rotar.
 */
export function planRotation<T extends RotationCandidate>(
  pool: T[],
  availableSlots: number,
  pickIndex: (max: number) => number = (max) => randomInt(max),
): RotationPlan<T> | null {
  const excess = pool.length - availableSlots;
  if (excess <= 0) return null;

  const reactivate = pool.filter((v) => v.suspendedByRotation);
  const cycleCompleted = pool.every((v) => v.rotationCycleCount > 0);
  const count = (v: T) => (cycleCompleted ? 0 : v.rotationCycleCount);

  const ordered = [...pool].sort((a, b) => {
    if (count(a) !== count(b)) return count(a) - count(b);
    const aTime = a.rotationSuspendedAt ? new Date(a.rotationSuspendedAt).getTime() : 0;
    const bTime = b.rotationSuspendedAt ? new Date(b.rotationSuspendedAt).getTime() : 0;
    return aTime - bTime;
  });

  const suspend = ordered.slice(0, excess);
  const suspended = new Set(suspend.map((v) => v.id));
  const inside = pool.filter((v) => !suspended.has(v.id));

  // Fisher–Yates sobre los números que ya existen en el grupo.
  const spots = [
    ...new Set(
      pool
        .map((v) => v.parkingSpot?.trim())
        .filter((spot): spot is string => !!spot),
    ),
  ];
  for (let i = spots.length - 1; i > 0; i--) {
    const j = pickIndex(i + 1);
    [spots[i], spots[j]] = [spots[j], spots[i]];
  }

  const spotById = new Map<string, string | null>();
  inside.forEach((v, i) => spotById.set(v.id, spots[i] ?? null));
  suspend.forEach((v) => spotById.set(v.id, null));

  return { reactivate, suspend, inside, cycleCompleted, spotById };
}
