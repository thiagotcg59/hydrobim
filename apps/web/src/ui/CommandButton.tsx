import { commandState, commandTitle, getCommand, type CommandContext } from '../commands/commands';

interface Props {
  id: string;
  context: CommandContext;
  /**
   * `large`: ícone sobre o rótulo (comandos principais); `small`: ícone e rótulo em linha;
   * `icon`: só o ícone (acesso rápido); `menu`: linha com a descrição (menus).
   */
  variant?: 'large' | 'small' | 'icon' | 'menu';
  /** Rótulo no lugar do nome do comando (ex.: "Planta Infra"). */
  label?: string;
  /** `data-testid` no lugar do padrão do comando, quando ele aparece em dois lugares. */
  testId?: string;
  onRun?: () => void;
}

/** Botão de um comando do registro: rótulo, dica, atalho e disponibilidade vêm de lá. */
export function CommandButton({ id, context, variant = 'large', label, testId, onRun }: Props) {
  const command = getCommand(id);
  const state = commandState(command, context);
  const Icon = command.icon;
  const text = label ?? command.label;
  const data = Object.fromEntries(
    Object.entries(state.data ?? {}).map(([key, value]) => [`data-${key}`, value]),
  );
  return (
    <button
      type="button"
      className={`cmd cmd--${variant}${state.active ? ' is-active' : ''}`}
      data-testid={testId ?? command.testId}
      data-command={command.id}
      {...data}
      disabled={!state.enabled}
      aria-pressed={state.active === undefined ? undefined : state.active}
      aria-label={variant === 'icon' ? text : undefined}
      role={variant === 'menu' ? 'menuitem' : undefined}
      title={commandTitle(command, state)}
      onClick={() => {
        command.run();
        onRun?.();
      }}
    >
      <Icon size={variant === 'large' ? 20 : 15} aria-hidden />
      {variant === 'menu' ? (
        <span className="cmd__text">
          <strong>{text}</strong>
          <small>{command.description}</small>
        </span>
      ) : (
        variant !== 'icon' && <span className="cmd__label">{text}</span>
      )}
      {command.phase && <span className="badge">{command.phase}</span>}
      {variant === 'menu' && command.shortcut && <kbd>{command.shortcut}</kbd>}
    </button>
  );
}
