import { useEffect, useMemo, useRef, useState } from 'react';
import { COMMANDS, commandState } from '../commands/commands';
import { useCommandContext } from '../commands/useCommands';
import { ribbonLocationOf } from './ToolBar';

interface Props {
  open: boolean;
  onClose: () => void;
}

const normalize = (text: string): string => text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/**
 * Busca de comandos sobre o mesmo registro da faixa e dos atalhos: mostra onde o comando
 * fica, o atalho e, quando indisponível, o motivo.
 */
export function CommandPalette({ open, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const context = useCommandContext();
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setQuery('');
      setIndex(0);
      dialog.showModal();
      inputRef.current?.focus();
    } else if (!open && dialog.open) dialog.close();
  }, [open]);

  const results = useMemo(() => {
    const text = normalize(query.trim());
    return COMMANDS.filter(
      (command) =>
        text.length === 0 || normalize(`${command.label} ${command.description}`).includes(text),
    ).slice(0, 40);
  }, [query]);

  const run = (position: number): void => {
    const command = results[position];
    if (!command || !commandState(command, context).enabled) return;
    onClose();
    command.run();
  };

  return (
    <dialog
      ref={dialogRef}
      className="dialog palette"
      data-testid="command-palette"
      onClose={onClose}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <input
        ref={inputRef}
        type="search"
        className="palette__input"
        data-testid="command-palette-input"
        placeholder="Buscar comando (ex.: tubo, exportar, níveis)…"
        aria-label="Buscar comando"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setIndex(0);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            setIndex((value) => Math.min(value + 1, results.length - 1));
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            setIndex((value) => Math.max(value - 1, 0));
          } else if (event.key === 'Enter') {
            event.preventDefault();
            run(index);
          }
        }}
      />
      <ul className="palette__list" role="listbox">
        {open &&
          results.map((command, position) => {
            const state = commandState(command, context);
            const Icon = command.icon;
            return (
              <li key={command.id} role="option" aria-selected={position === index}>
                <button
                  type="button"
                  className={position === index ? 'palette__item is-active' : 'palette__item'}
                  data-testid="command-palette-item"
                  data-command={command.id}
                  disabled={!state.enabled}
                  onMouseEnter={() => setIndex(position)}
                  onClick={() => run(position)}
                >
                  <Icon size={15} aria-hidden />
                  <span className="cmd__text">
                    <strong>{command.label}</strong>
                    <small>
                      {state.enabled ? command.description : `Indisponível: ${state.reason ?? ''}`}
                    </small>
                  </span>
                  <span className="palette__where">{ribbonLocationOf(command.id) ?? ''}</span>
                  {command.shortcut && <kbd>{command.shortcut}</kbd>}
                </button>
              </li>
            );
          })}
        {results.length === 0 && (
          <li className="muted palette__empty" data-testid="command-palette-empty">
            Nenhum comando encontrado.
          </li>
        )}
      </ul>
    </dialog>
  );
}
