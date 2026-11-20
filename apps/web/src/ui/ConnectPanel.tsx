import {
  formatMeters,
  getElement,
  resolvePort,
  type ConnectionAction,
  type PortRef,
  type Project,
} from '@hydrobim/core';
import { describeChanges } from '../editor/operationPreview';
import { chosenCandidate, useEditorStore } from '../state/editorStore';
import { guidesText, RELATION_LABELS } from '../state/viewPreview';

const ACTION_LABELS: Record<ConnectionAction, string> = {
  connect: 'Conectar',
  align: 'Alinhar',
  alignConnect: 'Alinhar e conectar',
  moveEquipment: 'Mover o equipamento',
};

/** "Tubo 3 · Fim · cota 1,200 m" — a cota evita ligar no nível errado. */
function portText(project: Project, ref: PortRef | null): string {
  if (!ref) return '—';
  const port = resolvePort(project, ref);
  const element = getElement(project, ref.elementId);
  if (!port || !element) return '—';
  return `${element.name} · ${port.label} · ${port.spec.sizeLabel}${
    port.end
      ? ` (${port.end.type === 'flange' ? 'flange' : port.end.type === 'socket' ? 'bolsa' : 'ponta'})`
      : ''
  } · cota ${formatMeters(port.position.z, 3)}`;
}

/**
 * Painel de "Alinhar e conectar": partida e referência (com a cota), guias medidas pela porta
 * real, alternativas (das mais simples às mais invasivas) com as peças e os elementos
 * afetados, e a confirmação, que grava exatamente a alternativa mostrada.
 */
export function ConnectPanel() {
  const project = useEditorStore((s) => s.project);
  const connect = useEditorStore((s) => s.connect);
  const { setConnectChoice, confirmConnection, resetConnection } = useEditorStore.getState();
  const plan = connect.plan && connect.plan.base === project ? connect.plan.result : null;
  const candidate = chosenCandidate(connect);

  return (
    <div className="options__group" data-testid="connection-panel">
      <span className="options__caption">Alinhar e conectar</span>
      <dl className="connect-steps">
        <dt>1. Extremidade do trecho</dt>
        <dd data-testid="connection-from">
          {connect.from ? portText(project, connect.from) : 'clique uma extremidade livre'}
        </dd>
        <dt>2. Porta de referência</dt>
        <dd data-testid="connection-to">
          {connect.to
            ? portText(project, connect.to)
            : connect.from
              ? 'clique a porta do equipamento ou peça'
              : '—'}
        </dd>
      </dl>

      {plan && !plan.ok && (
        <span className="options__error" data-testid="connection-error">
          {plan.error.message}
        </span>
      )}

      {plan?.ok && (
        <>
          <span className="muted" data-testid="connection-guides">
            {RELATION_LABELS[plan.value.guides.relation]}: {guidesText(plan.value.guides)}.
          </span>
          {!plan.value.candidates.some((option) => option.connects) && (
            <span className="options__error" data-testid="connection-none">
              Montagem impossível: {plan.value.refusals.join(' ') || 'sem peças compatíveis.'}
              {plan.value.candidates.length > 0
                ? ' Só é possível alinhar o trecho, sem registrar a ligação.'
                : ''}
            </span>
          )}
          {plan.value.candidates.length > 0 && (
            <div role="radiogroup" aria-label="Alternativas" className="connect-options">
              {plan.value.candidates.map((option) => {
                const active = option.key === candidate?.key;
                return (
                  <label
                    key={option.key}
                    className={active ? 'connect-option is-active' : 'connect-option'}
                    data-testid={`connection-option-${option.key}`}
                    data-action={option.action}
                  >
                    <input
                      type="radio"
                      name="connect-option"
                      checked={active}
                      onChange={() => setConnectChoice(option.key)}
                    />
                    <span>
                      <strong>{option.label}</strong>
                      <span className="connect-option__badge">{ACTION_LABELS[option.action]}</span>
                      <br />
                      <span className="muted">{option.summary}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          )}
          {candidate && (
            <div className="connect-details" data-testid="connection-details">
              {(() => {
                const changes = describeChanges(project, candidate.project);
                return (
                  <>
                    {changes.created.length > 0 && (
                      <>
                        <span className="options__caption">Peças inseridas</span>
                        <ul>
                          {changes.created.map((line) => (
                            <li key={line}>{line}</li>
                          ))}
                        </ul>
                      </>
                    )}
                    {changes.changed.length > 0 && (
                      <>
                        <span className="options__caption">Elementos existentes afetados</span>
                        <ul>
                          {changes.changed.map((line) => (
                            <li key={line}>{line}</li>
                          ))}
                        </ul>
                      </>
                    )}
                    <span className="muted">
                      {candidate.connects
                        ? 'A ligação entre as duas portas será registrada.'
                        : 'Só posiciona o trecho: nenhuma ligação é registrada.'}
                      {candidate.action === 'moveEquipment'
                        ? ' O equipamento será movido.'
                        : ' O equipamento fica fixo.'}
                    </span>
                  </>
                );
              })()}
            </div>
          )}
          {plan.value.refusals.length > 0 && plan.value.candidates.length > 0 && (
            <details className="muted" data-testid="connection-refusals">
              <summary>Alternativas indisponíveis</summary>
              <ul>
                {plan.value.refusals.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}

      <div className="options__actions">
        <button
          type="button"
          className="btn btn--primary"
          data-testid="connection-confirm"
          disabled={!candidate}
          onClick={() => confirmConnection()}
        >
          Confirmar
        </button>
        <button
          type="button"
          className="btn"
          data-testid="connection-reset"
          disabled={!connect.from}
          onClick={() => resetConnection()}
        >
          Recomeçar
        </button>
      </div>
    </div>
  );
}
