import { describe, expect, it } from 'vitest';
import { real, stepString } from './step';

describe('codificação STEP', () => {
  it('escapa apóstrofos, barras, controles e texto Unicode', () => {
    expect(stepString("D'água — aço 🛠")).toBe(
      "'D''\\X2\\00E1\\X0\\gua \\X2\\2014\\X0\\ a\\X2\\00E7\\X0\\o \\X2\\D83DDEE0\\X0\\'",
    );
    expect(stepString('\\X2\\literal\n')).toBe("'\\\\X2\\\\literal\\X2\\000A\\X0\\'");
    expect(stepString('çã')).toBe("'\\X2\\00E700E3\\X0\\'");
  });

  it('escreve reais com ponto decimal, expoente e sem valores não finitos', () => {
    expect(real(1)).toBe('1.');
    expect(real(-0)).toBe('0.');
    expect(real(1e-9)).toBe('1.E-9');
    expect(real(1e25)).toBe('1.E+25');
    expect(real(-1.25)).toBe('-1.25');
    expect(() => real(Infinity)).toThrow();
  });
});
