import { elementKindLabel, formatMeters, type HydroElement } from '@hydrobim/core';
import { ChevronDown, ChevronRight, Eye, EyeOff, MousePointerClick, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useCommandContext } from '../commands/useCommands';
import { useEditorStore } from '../state/editorStore';
import { CommandButton } from './CommandButton';
import { Section } from './fields';
import { SYSTEM_KIND_LABELS } from './labels';

/** Acima disto a lista de um sistema é cortada: redes extensas se percorrem pela busca. */
const MAX_ROWS = 300;

const actions = () => useEditorStore.getState();

/**
 * Navegador do projeto: vistas, níveis (planos de trabalho) e os elementos por sistema, com
 * busca, seleção e visibilidade. Não guarda regras: lê o projeto e chama a store.
 */
export function ProjectBrowser() {
  const context = useCommandContext();
  const project = useEditorStore((s) => s.project);
  const selection = useEditorStore((s) => s.selection);
  const workPlaneZ = useEditorStore((s) => s.workPlaneZ);
  const [query, setQuery] = useState('');
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  const infra = project.discipline === 'infra';

  const bySystem = useMemo(() => {
    const text = query.trim().toLowerCase();
    const groups = new Map<string, HydroElement[]>();
    for (const element of project.elements) {
      if (
        text &&
        !`${element.name} ${element.spec.sizeLabel} ${elementKindLabel(element.kind)}`
          .toLowerCase()
          .includes(text)
      ) {
        continue;
      }
      const list = groups.get(element.systemId);
      if (list) list.push(element);
      else groups.set(element.systemId, [element]);
    }
    return groups;
  }, [project.elements, query]);
  const selected = useMemo(() => new Set(selection), [selection]);
  const matches = [...bySystem.values()].reduce((total, list) => total + list.length, 0);

  const toggle = (id: string): void =>
    setClosed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="browser" data-testid="project-browser">
      <header className="panel__header">
        <h2>Navegador do projeto</h2>
      </header>
      <div className="panel__scroll">
        <Section title="Vistas" testId="nav-views">
          <div className="browser__views">
            <CommandButton id="view.model" context={context} variant="small" testId="nav-view-3d" />
            <CommandButton
              id="view.plan"
              context={context}
              variant="small"
              label={infra ? 'Planta Infra' : 'Planta MEP'}
              testId="nav-view-plan"
            />
            <CommandButton
              id="analysis.profile"
              context={context}
              variant="small"
              label="Perfil longitudinal…"
              testId="nav-view-profile"
            />
          </div>
        </Section>

        <Section title="Níveis" testId="nav-levels">
          {project.levels.length === 0 && (
            <span className="muted">Nenhum nível. Crie em Gerenciar › Níveis.</span>
          )}
          <ul className="browser__list">
            {project.levels.map((level) => {
              const active = Math.abs(level.elevation - workPlaneZ) < 1e-9;
              return (
                <li key={level.id}>
                  <button
                    type="button"
                    className={active ? 'browser__row is-active' : 'browser__row'}
                    data-testid="nav-level"
                    aria-pressed={active}
                    title={
                      active
                        ? 'Plano de trabalho atual'
                        : 'Usar este nível como plano de trabalho das ferramentas'
                    }
                    onClick={() => actions().setWorkPlaneZ(level.elevation)}
                  >
                    <span className="browser__name">{level.name}</span>
                    <span className="muted">{formatMeters(level.elevation, 2)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Section>

        <Section title="Sistemas e elementos" testId="nav-systems">
          <label className="browser__search">
            <Search size={13} aria-hidden />
            <span className="visually-hidden">Localizar elemento</span>
            <input
              type="search"
              data-testid="nav-search"
              placeholder="Localizar por nome, tipo ou diâmetro"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => event.stopPropagation()}
            />
          </label>
          {project.elements.length === 0 && (
            <span className="muted" data-testid="nav-empty">
              O projeto ainda não tem elementos. Use Modelagem › Tubulação para começar.
            </span>
          )}
          {project.elements.length > 0 && matches === 0 && (
            <span className="muted" data-testid="nav-no-match">
              Nenhum elemento corresponde à busca.
            </span>
          )}
          {project.systems.map((system) => {
            const elements = bySystem.get(system.id) ?? [];
            const visible = system.visible !== false;
            const isClosed = closed.has(system.id);
            if (query.trim() && elements.length === 0) return null;
            return (
              <div key={system.id} className="browser__system" data-testid="nav-system">
                <div className="browser__system-head">
                  <button
                    type="button"
                    className="browser__toggle"
                    aria-expanded={!isClosed}
                    aria-label={isClosed ? `Expandir ${system.name}` : `Recolher ${system.name}`}
                    onClick={() => toggle(system.id)}
                  >
                    {isClosed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                  </button>
                  {system.color && (
                    <span
                      className="browser__swatch"
                      style={{ background: system.color }}
                      title="Cor do sistema"
                    />
                  )}
                  <span
                    className={visible ? 'browser__name' : 'browser__name is-hidden'}
                    title={`${system.name} · ${SYSTEM_KIND_LABELS[system.kind]}`}
                  >
                    {system.name}
                  </span>
                  <span className="badge">{elements.length}</span>
                  <button
                    type="button"
                    className="browser__icon"
                    data-testid="nav-system-select"
                    disabled={elements.length === 0}
                    aria-label={`Selecionar os elementos de ${system.name}`}
                    title="Selecionar os elementos listados deste sistema"
                    onClick={() => actions().selectMany(elements.map((e) => e.id))}
                  >
                    <MousePointerClick size={13} />
                  </button>
                  <button
                    type="button"
                    className="browser__icon"
                    data-testid="nav-system-visibility"
                    aria-pressed={visible}
                    aria-label={visible ? `Ocultar ${system.name}` : `Exibir ${system.name}`}
                    title={
                      visible
                        ? 'Ocultar o sistema nas vistas (fica fora da captura de pontos)'
                        : 'Exibir o sistema nas vistas'
                    }
                    onClick={() => actions().updateSystem(system.id, { visible: !visible })}
                  >
                    {visible ? <Eye size={13} /> : <EyeOff size={13} />}
                  </button>
                </div>
                {!isClosed && (
                  <ul className="browser__list">
                    {elements.slice(0, MAX_ROWS).map((element) => (
                      <li key={element.id}>
                        <button
                          type="button"
                          data-testid="element-item"
                          data-element-id={element.id}
                          data-element-kind={element.kind}
                          className={
                            selected.has(element.id) ? 'browser__row is-active' : 'browser__row'
                          }
                          title={`${elementKindLabel(element.kind)} · Ctrl+clique para selecionar vários`}
                          onClick={(event) =>
                            actions().select(
                              element.id,
                              event.ctrlKey || event.metaKey || event.shiftKey,
                            )
                          }
                        >
                          <span className="browser__name">{element.name}</span>
                          <span className="muted">{element.spec.sizeLabel}</span>
                        </button>
                      </li>
                    ))}
                    {elements.length > MAX_ROWS && (
                      <li className="muted browser__more">
                        … mais {elements.length - MAX_ROWS} elemento(s). Use a busca para
                        localizá-los.
                      </li>
                    )}
                  </ul>
                )}
              </div>
            );
          })}
        </Section>
      </div>
    </div>
  );
}
