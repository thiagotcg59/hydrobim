import { formatDegrees, type HydroElement, type Project } from '@hydrobim/core';
import { Link2 } from 'lucide-react';
import { useMemo } from 'react';
import { useEditorStore } from '../state/editorStore';
import { planClosures } from '../state/pipePreview';
import { Section } from './fields';

/**
 * Fechamento assistido entre as extremidades livres de dois elementos selecionados. Cada
 * opção mostra as peças que serão criadas (a própria operação, calculada sem gravar); quando
 * não há solução, o motivo é o do núcleo. Nada é conectado por aproximação.
 */
export function CloseEnds({ elements, project }: { elements: HydroElement[]; project: Project }) {
  const toolOptions = useEditorStore((s) => s.toolOptions);
  const [first, second] = elements;
  const plans = useMemo(
    () => (first && second ? planClosures({ project, toolOptions }, first.id, second.id) : []),
    [project, toolOptions, first, second],
  );
  if (!first || !second) return null;
  const solved = plans.filter((plan) => plan.closures.length > 0);
  const refused = plans.filter((plan) => plan.closures.length === 0);

  return (
    <Section title="Ligar extremidades" testId="section-close">
      {plans.length === 0 && (
        <span className="muted" data-testid="close-none">
          Os dois elementos precisam ter extremidades livres para serem ligados.
        </span>
      )}
      {solved.map((plan, planIndex) => (
        <div key={`${plan.a.ref.portId}-${plan.b.ref.portId}`} className="close__pair">
          <span className="muted">
            {first.name} · {plan.a.label} ↔ {second.name} · {plan.b.label}
          </span>
          <div className="chips">
            {plan.closures.map((closure, index) => (
              <button
                key={index}
                type="button"
                className="chip"
                data-testid={`close-apply-${planIndex}-${index}`}
                data-kind={closure.kind}
                title="Criar as peças e conectar as duas extremidades"
                onClick={() =>
                  useEditorStore
                    .getState()
                    .closeFreeEnds(
                      plan.a.ref,
                      plan.b.ref,
                      closure.kind === 'offset' ? closure.angle : null,
                    )
                }
              >
                <Link2 size={13} />{' '}
                {closure.kind === 'offset' && closure.angle !== null
                  ? `Desvio ${formatDegrees(closure.angle, 2)}: `
                  : ''}
                {closure.summary}
              </button>
            ))}
          </div>
        </div>
      ))}
      {solved.length === 0 &&
        refused.slice(0, 2).map((plan) => (
          <span
            key={`${plan.a.ref.portId}-${plan.b.ref.portId}`}
            className="muted"
            data-testid="close-refusal"
          >
            {plan.a.label} ↔ {plan.b.label}: {plan.error}
          </span>
        ))}
      <span className="muted">
        A ligação usa só tubos e joelhos da especificação das extremidades e fecha exatamente; se
        não fechar, nada é criado.
      </span>
    </Section>
  );
}
