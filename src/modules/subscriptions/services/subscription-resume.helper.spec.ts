import { EntityManager } from 'typeorm';

import { recordResumeIfNeeded } from './subscription-resume.helper';

const NOW = new Date('2026-11-09T13:00:00.000Z');
const inDays = (d: number) => new Date(NOW.getTime() + d * 86_400_000);

// Sin métodos: si el helper intentara escribir, la prueba revienta.
const untouched = {} as EntityManager;

describe('recordResumeIfNeeded', () => {
  it('no hace nada con un conjunto que estaba en gracia', async () => {
    await expect(
      recordResumeIfNeeded(untouched, 'c', inDays(-4), inDays(30), NOW),
    ).resolves.toBeNull();
  });

  it('no hace nada sin vencimiento anterior', async () => {
    await expect(
      recordResumeIfNeeded(untouched, 'c', null, inDays(30), NOW),
    ).resolves.toBeNull();
  });

  it('no hace nada si la fecha nueva sigue pausada', async () => {
    await expect(
      recordResumeIfNeeded(untouched, 'c', inDays(-40), inDays(-6), NOW),
    ).resolves.toBeNull();
  });
});
