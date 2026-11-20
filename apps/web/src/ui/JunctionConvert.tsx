import type { Cross, Project, Tee } from '@hydrobim/core';
import { useState } from 'react';
import { describeChanges } from '../editor/operationPreview';
import { catalogOf, useEditorStore } from '../state/editorStore';
import { Section, SelectField } from './fields';

/**
 * Conversão tê ⇄ cruzeta pelo painel: escolha da família (as compatíveis com a passagem e a
 * derivação, de qualquer acabamento), prévia — a própria operação, calculada sem gravar,
 * também desenhada nas vistas — e confirmação, que grava exatamente o que a prévia mostrou.
 */
export function JunctionConvert({ element, project }: { element: Tee | Cross; project: Project }) {
  const toolOptions = useEditorStore((s) => s.toolOptions);
  const preview = useEditorStore((s) =>
    s.junctionPreview?.elementId === element.id ? s.junctionPreview : null,
  );
  const [familyId, setFamilyId] = useState<string | null>(null);
  const target = element.kind === 'tee' ? 'cross' : 'tee';
  const families =
    catalogOf(project, toolOptions.families).junctionFamilies?.(
      target,
      element.spec,
      element.branchSpec ?? element.spec,
    ) ?? [];
  const { previewJunction, confirmJunction, cancelJunction } = useEditorStore.getState();
  const action = target === 'cross' ? 'Converter em cruzeta' : 'Converter em tê';
  const current = preview && preview.base === project ? preview : null;

  return (
    <Section title="Tê ⇄ cruzeta" testId="section-junction">
      <SelectField
        label={target === 'cross' ? 'Família da cruzeta' : 'Família do tê'}
        testId="junction-family"
        value={familyId ?? 'auto'}
        options={[
          {
            value: 'auto',
            label:
              families.length > 0 ? 'Automática (mesmo acabamento)' : 'Sem família de catálogo',
          },
          ...families.map((family) => ({ value: family.id, label: family.name })),
        ]}
        onChange={(value) => {
          const next = value === 'auto' ? null : value;
          setFamilyId(next);
          if (current) previewJunction(element.id, next);
        }}
      />
      {families.length === 0 && (
        <span className="muted" data-testid="junction-unavailable">
          {`Não há ${target === 'cross' ? 'cruzeta' : 'tê'} de catálogo para ${element.spec.standard}, ${element.spec.sizeLabel}${
            element.branchSpec ? ` × ${element.branchSpec.sizeLabel}` : ''
          }.`}
        </span>
      )}
      <button
        type="button"
        className="btn"
        data-testid="junction-preview"
        onClick={() => previewJunction(element.id, familyId)}
      >
        {action}…
      </button>
      {current && !current.result.ok && (
        <span className="options__error" data-testid="junction-error">
          {current.result.error.message}
        </span>
      )}
      {current?.result.ok && (
        <div className="connect-details" data-testid="junction-details">
          {(() => {
            const changes = describeChanges(project, current.result.value.project);
            return (
              <>
                <span className="options__caption">Resultado</span>
                <ul>
                  {changes.changed.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
                {current.result.value.notes.length > 0 && (
                  <ul className="muted" data-testid="junction-notes">
                    {current.result.value.notes.map((note) => (
                      <li key={note}>{note}</li>
                    ))}
                  </ul>
                )}
                <span className="muted">
                  O elemento, o nome, o sistema e as ligações são mantidos
                  {target === 'cross' ? '; a quarta porta fica livre.' : '.'}
                </span>
              </>
            );
          })()}
          <div className="options__actions">
            <button
              type="button"
              className="btn btn--primary"
              data-testid="junction-confirm"
              onClick={() => confirmJunction()}
            >
              Confirmar
            </button>
            <button
              type="button"
              className="btn"
              data-testid="junction-cancel"
              onClick={() => cancelJunction()}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </Section>
  );
}
