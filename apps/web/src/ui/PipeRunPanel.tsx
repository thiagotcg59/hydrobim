import { MATERIAL_LABELS } from '@hydrobim/catalog';
import {
  ANGLE_TOLERANCE,
  formatDegrees,
  formatMeters,
  pipeLength,
  type PipeRunSummary,
} from '@hydrobim/core';
import type { ReactNode } from 'react';
import { useEditorStore } from '../state/editorStore';
import { ReadOnlyRow, Section } from './fields';

/**
 * Propriedades de uma tubulação contínua: tubos ligados direto uns aos outros, sem peça entre
 * eles, apresentados como um tubo só. Os trechos continuam sendo elementos; cada um pode ser
 * aberto pela lista para edição individual. `children` recebe as ações comuns da seleção
 * (sistema, mover, excluir), que valem para todos os trechos.
 */
export function PipeRunPanel({ run, children }: { run: PipeRunSummary; children?: ReactNode }) {
  const first = run.pipes[0];
  const last = run.pipes.at(-1);
  if (!first || !last) return null;
  const turns = run.deflections.filter((d) => d > ANGLE_TOLERANCE).length;
  return (
    <div className="panel__scroll" data-testid="pipe-run-properties" data-count={run.pipes.length}>
      <Section title="Tubulação contínua" testId="section-pipe-run">
        <ReadOnlyRow
          label="Especificação"
          value={`${first.spec.standard} · ${first.spec.sizeLabel}`}
        />
        <ReadOnlyRow label="Material" value={MATERIAL_LABELS[first.spec.material]} />
        <ReadOnlyRow
          label="Comprimento total"
          value={<span data-testid="pipe-run-length">{formatMeters(run.length, 2)}</span>}
        />
        <ReadOnlyRow
          label="Trechos"
          value={<span data-testid="pipe-run-count">{run.pipes.length}</span>}
        />
        <ReadOnlyRow
          label="Mudanças de direção"
          value={
            <span data-testid="pipe-run-turns">
              {turns === 0
                ? 'nenhuma (alinhada)'
                : `${turns}, sem peça · maior desvio ${formatDegrees(run.maxDeflection, 2)}`}
            </span>
          }
        />
        <span className="muted">
          Não há conexão, tê nem acessório entre os trechos: a seleção e as ações abaixo valem para
          a tubulação inteira. O comprimento é a soma dos trechos.
        </span>
      </Section>
      <Section title="Trechos" testId="section-pipe-run-segments">
        {run.pipes.map((pipe, index) => {
          const turn = run.deflections[index];
          return (
            <button
              key={pipe.id}
              type="button"
              className="link"
              data-testid={`pipe-run-segment-${index}`}
              title="Selecionar só este trecho para editá-lo"
              onClick={() => useEditorStore.getState().selectMany([pipe.id])}
            >
              {index + 1}. {pipe.name} · {formatMeters(pipeLength(pipe), 2)}
              {turn !== undefined && turn > ANGLE_TOLERANCE
                ? ` · desvio de ${formatDegrees(turn, 2)} para o seguinte`
                : ''}
            </button>
          );
        })}
      </Section>
      {children}
    </div>
  );
}
