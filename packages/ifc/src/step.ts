/** STEP usa ASCII; X2 transporta unidades UTF-16, inclusive pares substitutos. */
export function stepString(value: string): string {
  let result = "'";
  let unicode = '';
  const flush = (): void => {
    if (unicode) result += `\\X2\\${unicode}\\X0\\`;
    unicode = '';
  };
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 32 || code > 126) {
      unicode += code.toString(16).toUpperCase().padStart(4, '0');
    } else {
      flush();
      const char = value.charAt(i);
      result += char === "'" ? "''" : char === '\\' ? '\\\\' : char;
    }
  }
  flush();
  return `${result}'`;
}

export function real(value: number): string {
  if (!Number.isFinite(value)) throw new Error('O IFC não aceita números não finitos.');
  const [mantissa = '0', exponent] = value.toString().toUpperCase().split('E');
  const decimal = mantissa.includes('.') ? mantissa : `${mantissa}.`;
  return exponent === undefined ? decimal : `${decimal}E${exponent}`;
}

export const list = (values: readonly string[]): string => `(${values.join(',')})`;
export const enumeration = (value: string): string => `.${value}.`;

/** Argumentos já codificados: referências, valores tipados, enumerações e listas STEP. */
export class StepWriter {
  private readonly lines: string[] = [];

  entity(type: string, ...attributes: string[]): string {
    const ref = `#${this.lines.length + 1}`;
    this.lines.push(`${ref}=${type.toUpperCase()}(${attributes.join(',')});`);
    return ref;
  }

  toString(): string {
    return this.lines.join('\n');
  }
}
