import { ChevronDown, ChevronRight } from 'lucide-react';
import { useEffect, useId, useState, type ReactNode } from 'react';

/** Interpreta números digitados com vírgula ou ponto decimal. */
export function parseDecimal(text: string): number {
  const normalized = text.trim().replace(/\s/g, '').replace(',', '.');
  if (normalized.length === 0) return Number.NaN;
  return Number(normalized);
}

export function formatDecimal(value: number, digits: number): string {
  if (!Number.isFinite(value)) return '';
  // Remove zeros à direita mantendo a precisão informada.
  return String(Number(value.toFixed(digits))).replace('.', ',');
}

interface NumberFieldProps {
  label: string;
  /** Valor na unidade de apresentação. */
  value: number;
  onCommit: (value: number) => void;
  unit?: string;
  digits?: number;
  disabled?: boolean;
  title?: string;
  testId?: string;
}

/**
 * Campo numérico que só confirma o valor ao sair do campo ou ao pressionar Enter,
 * evitando alterar o modelo a cada tecla.
 */
export function NumberField({
  label,
  value,
  onCommit,
  unit,
  digits = 3,
  disabled,
  title,
  testId,
}: NumberFieldProps) {
  const id = useId();
  const [text, setText] = useState(() => formatDecimal(value, digits));
  const [invalid, setInvalid] = useState(false);
  // Conta as confirmações: se a alteração for recusada pelo domínio, `value` não muda e o
  // campo precisa voltar a mostrar o valor vigente, não o texto digitado.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setText(formatDecimal(value, digits));
    setInvalid(false);
  }, [value, digits, attempt]);

  const commit = (): void => {
    const parsed = parseDecimal(text);
    if (!Number.isFinite(parsed)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    if (Math.abs(parsed - value) > 10 ** -(digits + 2)) {
      onCommit(parsed);
      setAttempt((count) => count + 1);
    } else setText(formatDecimal(value, digits));
  };

  return (
    <label className="field" htmlFor={id} title={title}>
      <span className="field__label">{label}</span>
      <span className={`field__control${invalid ? ' field__control--invalid' : ''}`}>
        <input
          id={id}
          data-testid={testId}
          type="text"
          inputMode="decimal"
          value={text}
          disabled={disabled}
          aria-invalid={invalid}
          onChange={(event) => setText(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              // Sair do campo confirma o valor: confirmar aqui também gravaria duas vezes
              // (dois passos no histórico para uma única alteração).
              event.currentTarget.blur();
            } else if (event.key === 'Escape') {
              setText(formatDecimal(value, digits));
              setInvalid(false);
              event.currentTarget.blur();
            }
            event.stopPropagation();
          }}
        />
        {unit && <span className="field__unit">{unit}</span>}
      </span>
    </label>
  );
}

interface TextFieldProps {
  label: string;
  value: string;
  onCommit: (value: string) => void;
  testId?: string;
}

export function TextField({ label, value, onCommit, testId }: TextFieldProps) {
  const id = useId();
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <label className="field" htmlFor={id}>
      <span className="field__label">{label}</span>
      <span className="field__control">
        <input
          id={id}
          data-testid={testId}
          type="text"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onBlur={() => {
            if (text !== value) onCommit(text);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
            event.stopPropagation();
          }}
        />
      </span>
    </label>
  );
}

interface SelectFieldProps<T extends string> {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  disabled?: boolean;
  testId?: string;
}

export function SelectField<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
  testId,
}: SelectFieldProps<T>) {
  const id = useId();
  return (
    <label className="field" htmlFor={id}>
      <span className="field__label">{label}</span>
      <span className="field__control">
        <select
          id={id}
          data-testid={testId}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value as T)}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </span>
    </label>
  );
}

export function ReadOnlyRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="row">
      <span className="row__label">{label}</span>
      <span className="row__value">{value}</span>
    </div>
  );
}

export function Section({
  title,
  children,
  testId,
  icon,
}: {
  title: string;
  children: ReactNode;
  testId?: string;
  icon?: ReactNode;
}) {
  // Recolher uma seção é preferência de leitura da sessão: não é dado do projeto.
  const [collapsed, setCollapsed] = useState(false);
  return (
    <section
      className={collapsed ? 'section is-collapsed' : 'section'}
      data-testid={testId}
      data-collapsed={collapsed}
    >
      <h3 className="section__title">
        <button
          type="button"
          className="section__toggle"
          data-testid={testId ? `${testId}-toggle` : undefined}
          aria-expanded={!collapsed}
          title={collapsed ? 'Expandir a seção' : 'Recolher a seção'}
          onClick={() => setCollapsed((value) => !value)}
        >
          {collapsed ? (
            <ChevronRight className="section__caret" size={13} aria-hidden />
          ) : (
            <ChevronDown className="section__caret" size={13} aria-hidden />
          )}
          {icon && (
            <span className="section__icon" aria-hidden>
              {icon}
            </span>
          )}
          <span>{title}</span>
        </button>
      </h3>
      {!collapsed && children}
    </section>
  );
}
