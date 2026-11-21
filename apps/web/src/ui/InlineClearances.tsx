import {
  getElement,
  inlineClearancesOf,
  type HydroElement,
  type InlineClearance,
  type Project,
} from '@hydrobim/core';
import { useEditorStore } from '../state/editorStore';
import { useUiStore } from '../state/uiStore';
import { NumberField, ReadOnlyRow, Section } from './fields';

/** Nome do que está no fim da cota: o próximo elemento ou a extremidade livre do tubo. */
function targetName(project: Project, clearance: InlineClearance): string {
  const { target } = clearance;
  if (target.kind === 'free') {
    const pipe = getElement(project, target.pipeId);
    return `extremidade livre${pipe ? ` de "${pipe.name}"` : ''}`;
  }
  const element = getElement(project, target.elementId);
  return element ? `"${element.name}"` : 'elemento';
}

/**
 * Posição da peça na linha: o tubo de cada extremidade até o próximo elemento (porta a porta,
 * isto é, o comprimento de tubo entre as peças). Em trecho reto, a cota é editável — a peça
 * desliza e o tubo do outro lado compensa.
 */
export function InlineClearances({
  element,
  project,
}: {
  element: HydroElement;
  project: Project;
}) {
  const shown = useUiStore((s) => s.inlineClearances);
  const clearances = inlineClearancesOf(project, element.id);
  if (clearances.length === 0) return null;
  return (
    <Section title="Posição na linha" testId="section-inline-clearances">
      <label className="check">
        <input
          type="checkbox"
          data-testid="inline-clearances-toggle"
          checked={shown}
          onChange={(event) => useUiStore.getState().setInlineClearances(event.target.checked)}
        />
        Mostrar as cotas nas vistas
      </label>
      {clearances.map((clearance) => {
        const label = `${clearance.portLabel} → ${targetName(project, clearance)}`;
        const editable = clearance.straight && clearance.pipeIds.length > 0;
        return editable ? (
          <NumberField
            key={clearance.portId}
            label={label}
            value={clearance.length}
            unit="m"
            digits={3}
            title="Comprimento de tubo entre a peça e o próximo elemento (porta a porta). Alterar desliza a peça; o tubo do outro lado compensa."
            testId={`inline-clearance-input-${clearance.portId}`}
            onCommit={(value) =>
              useEditorStore.getState().setInlineClearanceOf(element.id, clearance.portId, value)
            }
          />
        ) : (
          <ReadOnlyRow
            key={clearance.portId}
            label={label}
            value={
              <span data-testid={`inline-clearance-value-${clearance.portId}`}>
                {clearance.pipeIds.length === 0
                  ? 'encostada (sem tubo)'
                  : `${clearance.length.toFixed(3).replace('.', ',')} m pelo percurso (trecho com mudança de direção)`}
              </span>
            }
          />
        );
      })}
    </Section>
  );
}
