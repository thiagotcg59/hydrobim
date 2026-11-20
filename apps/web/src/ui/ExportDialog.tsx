import { X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { COMMANDS, commandState, type ExportDetails } from '../commands/commands';
import { useCommandContext } from '../commands/useCommands';

interface Props {
  open: boolean;
  onClose: () => void;
}

const KINDS: ExportDetails['kind'][] = ['Modelo', 'Planta', 'Dados'];
const KIND_NOTES: Record<ExportDetails['kind'], string> = {
  Modelo: 'O modelo 3D inteiro, com ou sem informação BIM.',
  Planta: 'O desenho técnico em planta do ambiente atual, com as anotações.',
  Dados: 'Tabelas e arquivos de dados derivados do modelo, sem geometria de desenho.',
};

/** Conteúdo, opções e requisitos de cada saída, lidos do registro de comandos. */
export function ExportDialog({ open, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const context = useCommandContext();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  const outputs = COMMANDS.filter((command) => command.details !== undefined);

  return (
    <dialog
      ref={dialogRef}
      className="dialog dialog--wide"
      data-testid="export-dialog"
      onClose={onClose}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <header className="dialog__header">
        <h2>Exportação: conteúdo e requisitos de cada saída</h2>
        <button
          type="button"
          className="btn btn--icon"
          onClick={onClose}
          aria-label="Fechar"
          data-testid="export-close"
        >
          <X size={16} />
        </button>
      </header>
      <div className="dialog__body dialog__body--tall">
        <p className="muted">
          O arquivo nativo do projeto (.hydrobim.json), que reabre no HydroBIM sem perda, fica em
          Arquivo › Baixar arquivo. As saídas abaixo são para outros programas.
        </p>
        {open &&
          KINDS.map((kind) => (
            <section key={kind} className="exports" data-testid={`export-kind-${kind}`}>
              <h3 className="section__title">
                {kind} — <span className="exports__note">{KIND_NOTES[kind]}</span>
              </h3>
              {outputs
                .filter((command) => command.details?.kind === kind)
                .map((command) => {
                  const details = command.details;
                  if (!details) return null;
                  const state = commandState(command, context);
                  const Icon = command.icon;
                  return (
                    <article key={command.id} className="exports__row" data-testid="export-row">
                      <div className="exports__head">
                        <Icon size={16} aria-hidden />
                        <strong>{command.label}</strong>
                        <code>{details.format}</code>
                      </div>
                      <dl className="exports__details">
                        <dt>Conteúdo</dt>
                        <dd>{details.content}</dd>
                        <dt>Opções</dt>
                        <dd>{details.options}</dd>
                        <dt>Requisitos</dt>
                        <dd>{details.requirements}</dd>
                      </dl>
                      <div className="exports__action">
                        <button
                          type="button"
                          className="btn btn--primary"
                          data-testid={`export-run-${command.id.replace('export.', '')}`}
                          disabled={!state.enabled}
                          title={state.enabled ? command.description : state.reason}
                          onClick={() => {
                            // O SVG abre a planta: o diálogo sai da frente antes.
                            onClose();
                            command.run();
                          }}
                        >
                          Exportar
                        </button>
                        {!state.enabled && state.reason && (
                          <span className="warn" data-testid="export-blocked">
                            {state.reason}
                          </span>
                        )}
                      </div>
                    </article>
                  );
                })}
            </section>
          ))}
      </div>
    </dialog>
  );
}
