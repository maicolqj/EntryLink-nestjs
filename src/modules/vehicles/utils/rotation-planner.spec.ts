import { planRotation, RotationCandidate } from './rotation-planner';

const car = (id: string, partial: Partial<RotationCandidate> = {}): RotationCandidate => ({
  id,
  parkingSpot: null,
  suspendedByRotation: false,
  rotationCycleCount: 0,
  rotationSuspendedAt: null,
  ...partial,
});

/** Aplica un plan como lo hace el servicio, para simular varias rotaciones. */
const apply = (pool: RotationCandidate[], slots: number, at: number) => {
  const plan = planRotation(pool, slots, () => 0)!;
  const out = new Set(plan.suspend.map((v) => v.id));
  for (const v of pool) {
    if (plan.cycleCompleted) v.rotationCycleCount = 0;
    if (out.has(v.id)) {
      v.suspendedByRotation = true;
      v.rotationCycleCount += 1;
      v.rotationSuspendedAt = new Date(at);
    } else {
      v.suspendedByRotation = false;
    }
    v.parkingSpot = plan.spotById.get(v.id) ?? null;
  }
  return plan;
};

describe('planRotation', () => {
  it('sin vehículos de más no hay nada que rotar', () => {
    expect(planRotation([car('a'), car('b')], 2)).toBeNull();
  });

  it('sale el que menos veces ha salido y los que estaban fuera vuelven', () => {
    const pool = [
      car('a', { rotationCycleCount: 1, suspendedByRotation: true, rotationSuspendedAt: new Date(10) }),
      car('b', { rotationCycleCount: 0 }),
      car('c', { rotationCycleCount: 1, rotationSuspendedAt: new Date(5) }),
    ];

    const plan = planRotation(pool, 2)!;

    expect(plan.suspend.map((v) => v.id)).toEqual(['b']);
    expect(plan.reactivate.map((v) => v.id)).toEqual(['a']);
    expect(plan.inside.map((v) => v.id).sort()).toEqual(['a', 'c']);
  });

  it('nadie repite hasta que todos hayan salido una vez', () => {
    const pool = ['a', 'b', 'c', 'd', 'e'].map((id) => car(id));
    const salieron: string[] = [];

    // 5 vehículos, 3 cupos: salen 2 por rotación.
    for (let turn = 1; turn <= 3; turn++) {
      const plan = apply(pool, 3, turn);
      salieron.push(...plan.suspend.map((v) => v.id));
    }

    // En las dos primeras rotaciones salen 4 distintos; en la tercera sale el
    // que faltaba antes de que alguien repita.
    expect(new Set(salieron.slice(0, 4)).size).toBe(4);
    expect(salieron.slice(0, 5)).toEqual(expect.arrayContaining(['a', 'b', 'c', 'd', 'e']));
  });

  it('cuando todos ya salieron, arranca un ciclo nuevo', () => {
    const pool = [
      car('a', { rotationCycleCount: 1, rotationSuspendedAt: new Date(1) }),
      car('b', { rotationCycleCount: 1, rotationSuspendedAt: new Date(2) }),
      car('c', { rotationCycleCount: 1, rotationSuspendedAt: new Date(3), suspendedByRotation: true }),
    ];

    const plan = planRotation(pool, 2)!;

    expect(plan.cycleCompleted).toBe(true);
    // El que salió hace más tiempo sale primero en el ciclo nuevo.
    expect(plan.suspend.map((v) => v.id)).toEqual(['a']);
  });

  it('los números de cupo se reparten solo entre los que quedan dentro', () => {
    const pool = [
      car('a', { parkingSpot: 'P-01' }),
      car('b', { parkingSpot: 'P-02' }),
      car('c', { parkingSpot: 'P-03', rotationCycleCount: 1, rotationSuspendedAt: new Date(1) }),
      car('d', { suspendedByRotation: true, rotationCycleCount: 1, rotationSuspendedAt: new Date(2) }),
    ];

    const plan = planRotation(pool, 3)!;
    const out = plan.suspend[0].id;

    expect(plan.spotById.get(out)).toBeNull();
    const assigned = plan.inside.map((v) => plan.spotById.get(v.id));
    // Los tres números existentes quedan repartidos entre los tres de adentro,
    // sin repetir ni perder ninguno.
    expect(assigned.sort()).toEqual(['P-01', 'P-02', 'P-03']);
  });

  it('el reparto es al azar', () => {
    const pool = () => [
      car('a', { parkingSpot: 'P-01' }),
      car('b', { parkingSpot: 'P-02' }),
      car('c', { parkingSpot: 'P-03' }),
      car('d'),
    ];

    const first = planRotation(pool(), 3, (max) => max - 1)!;
    const second = planRotation(pool(), 3, () => 0)!;

    const spotsOf = (plan: ReturnType<typeof planRotation>) =>
      plan!.inside.map((v) => plan!.spotById.get(v.id)).join(',');
    expect(spotsOf(first)).not.toEqual(spotsOf(second));
  });
});
