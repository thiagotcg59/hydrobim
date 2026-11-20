import { commandState, commandTitle, getCommand, type CommandContext } from '../commands/commands';

interface Props {
  id: string;
  context: CommandContext;
  /**
   * `large`: ícone e rótulo (comandos principais da faixa); `compact`: comando secundário da
   * faixa, só o ícone em telas estreitas; `small`: ícone e rótulo menores, em linha; `icon`: só
   * o ícone (acesso rápido); `menu`: linha com a descrição (menus).
   */
  variant?: 'large' | 'compact' | 'small' | 'icon' | 'menu';
  /** Rótulo no lugar do nome do comando (ex.: "Planta Infra"). */
  label?: string;
  /** `data-testid` no lugar do padrão do comando, quando ele aparece em dois lugares. */
  testId?: string;
  onRun?: () => void;
}

/** Tamanho do desenho do ícone; a área clicável é maior e vem do estilo do botão. */
const ICON_SIZE = { large: 20, compact: 20, small: 16, icon: 18, menu: 18 } as const;

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
      aria-label={variant === 'icon' || variant === 'compact' ? text : undefined}
      role={variant === 'menu' ? 'menuitem' : undefined}
      title={commandTitle(command, state)}
      onClick={() => {
        command.run();
        onRun?.();
      }}
    >
      <Icon size={ICON_SIZE[variant]} className="cmd__icon" aria-hidden />
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
