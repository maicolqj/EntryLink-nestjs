import { isGrowthEnabled } from './growth.flag';

describe('GROWTH_ENABLED', () => {
  it.each([
    [undefined, false],
    ['', false],
    ['false', false],
    ['0', false],
    ['yes', false],
    ['true', true],
    [' TRUE ', true],
  ])('%p → %p', (value, expected) => {
    expect(isGrowthEnabled({ GROWTH_ENABLED: value })).toBe(expected);
  });

  it('variable ausente = apagada (la forma con string de ConditionalModule la encendería)', () => {
    expect(isGrowthEnabled({})).toBe(false);
    // Lo que haría `registerWhen(mod, 'GROWTH_ENABLED')`:
    const stringForm = (env: NodeJS.ProcessEnv) =>
      env.GROWTH_ENABLED?.toLowerCase() !== 'false';
    expect(stringForm({})).toBe(true);
  });
});
