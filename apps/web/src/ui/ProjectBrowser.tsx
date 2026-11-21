import { elementKindLabel, formatMeters, type HydroElement } from '@hydrobim/core';
import {
  Building2,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Folder,
  FolderOpen,
  Globe2,
  House,
  Layers2,
  Mountain,
  MousePointerClick,
  Network,
  Search,
  type LucideIcon,
} from 'lucide-react';
import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { useArchStore } from '../arch/archStore';
import { archTreeCount, archTreeOf } from '../arch/archTree';
import { getCommand } from '../commands/commands';
import { useCommandContext } from '../commands/useCommands';
import { useEditorStore } from '../state/editorStore';
import { EarthworkNavRows } from '../terrain/EarthworkNavRows';
import { ViewNavigator } from '../views/ViewNavigator';
import { CommandButton } from './CommandButton';
import { ARCH_ICONS, ELEMENT_ICONS } from './EngineeringIcons';
import { DISCIPLINE_LABELS, PLAN_LABELS, SYSTEM_KIND_LABELS } from './labels';

/** Acima disto a lista de uma categoria é cortada: redes extensas se percorrem pela busca. */
const MAX_ROWS = 300;

const actions = () => useEditorStore.getState();

/** Categorias de elementos dentro de um sistema, na ordem em que aparecem na árvore. */
const SYSTEM_CATEGORIES: readonly {
  id: string;
  label: string;
  icon: LucideIcon;
  kinds: readonly HydroElement['kind'][];
}[] = [
  { id: 'pipes', label: 'Tubos', icon: ELEMENT_ICONS.pipe, kinds: ['pipe'] },
  {
    id: 'fittings',
    label: 'Conexões',
    icon: ELEMENT_ICONS.elbow,
    kinds: ['elbow', 'tee', 'reducer'],
  },
  { id: 'valves', label: 'Válvulas', icon: ELEMENT_ICONS.valve, kinds: ['valve'] },
];

const indent = (level: number): CSSProperties => ({ '--level': level }) as CSSProperties;

interface BranchProps {
  id: string;
  level: number;
  label: string;
  icon: ReactNode;
  count?: number;
  open: boolean;
  onToggle: (id: string) => void;
  testId?: string;
  children: ReactNode;
}

/** Nó de organização da árvore (categoria): seta, símbolo, nome e quantidade. */
function Branch({ id, level, label, icon, count, open, onToggle, testId, children }: BranchProps) {
  return (
    <li className="tree__branch" data-testid={testId} data-collapsed={!open}>
      <button
        type="button"
        className="tree__row tree__row--branch"
        style={indent(level)}
        data-testid={testId ? `${testId}-toggle` : undefined}
        aria-expanded={open}
        title={open ? `Recolher ${label}` : `Expandir ${label}`}
        onClick={() => onToggle(id)}
      >
        <span className="tree__caret" aria-hidden>
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
        <span className="tree__icon" aria-hidden>
          {icon}
        </span>
        <span className="tree__label">{label}</span>
        {count !== undefined && <span className="tree__count">{count}</span>}
      </button>
      {open && <ul className="tree__children">{children}</ul>}
    </li>
  );
}

/**
 * Navegador do projeto: árvore com pavimentos (planos de trabalho), sistemas com os seus
 * tubos, conexões e válvulas, equipamentos, reservatórios e referências do local; busca,
 * seleção e visibilidade por sistema; e as vistas. Só categorias que o modelo sustenta. Não
 * guarda regras: lê o projeto e chama a store.
 */
export function ProjectBrowser() {
  const context = useCommandContext();
  const project = useEditorStore((s) => s.project);
  const selection = useEditorStore((s) => s.selection);
  const workPlaneZ = useEditorStore((s) => s.workPlaneZ);
  const [query, setQuery] = useState('');
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  const infra = project.discipline === 'infra';
  const searching = query.trim().length > 0;

  const systemNames = useMemo(
    () => new Map(project.systems.map((system) => [system.id, system.name])),
    [project.systems],
  );
  const hiddenSystems = useMemo(
    () => new Set(project.systems.filter((s) => s.visible === false).map((s) => s.id)),
    [project.systems],
  );
  const matching = useMemo(() => {
    const text = query.trim().toLowerCase();
    if (!text) return project.elements;
    return project.elements.filter((element) =>
      `${element.name} ${element.spec.sizeLabel} ${elementKindLabel(element.kind)} ${systemNames.get(element.systemId) ?? ''}`
        .toLowerCase()
        .includes(text),
    );
  }, [project.elements, systemNames, query]);
  const bySystem = useMemo(() => {
    const groups = new Map<string, HydroElement[]>();
    for (const element of matching) {
      const list = groups.get(element.systemId);
      if (list) list.push(element);
      else groups.set(element.systemId, [element]);
    }
    return groups;
  }, [matching]);
  const selected = useMemo(() => new Set(selection), [selection]);
  const archSelection = useArchStore((s) => s.selection);
  const archSelected = useMemo(() => new Set(archSelection), [archSelection]);
  const archTree = useMemo(
    () => archTreeOf({ levels: project.levels, architecture: project.architecture }, query),
    [project.levels, project.architecture, query],
  );
  const archCount = archTreeCount(archTree);
  const archTotal = project.architecture.elements.length;
  const pumps = matching.filter((element) => element.kind === 'pump');
  const tanks = matching.filter((element) => element.kind === 'tank');

  const toggle = (id: string): void =>
    setClosed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  // Durante a busca tudo fica aberto: o resultado não pode ficar escondido em um nó recolhido.
  const isOpen = (id: string): boolean => searching || !closed.has(id);

  const elementRows = (elements: readonly HydroElement[], level: number): ReactNode => (
    <>
      {elements.slice(0, MAX_ROWS).map((element) => {
        const Icon = ELEMENT_ICONS[element.kind];
        const active = selected.has(element.id);
        return (
          <li key={element.id}>
            <button
              type="button"
              data-testid="element-item"
              data-element-id={element.id}
              data-element-kind={element.kind}
              aria-pressed={active}
              className={[
                'tree__row',
                'tree__row--leaf',
                active ? 'is-active' : '',
                hiddenSystems.has(element.systemId) ? 'is-hidden' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              style={indent(level)}
              title={`${element.name} · ${elementKindLabel(element.kind)} · ${element.spec.sizeLabel} · ${systemNames.get(element.systemId) ?? ''}\nCtrl+clique para selecionar vários`}
              onClick={(event) =>
                actions().select(element.id, event.ctrlKey || event.metaKey || event.shiftKey)
              }
            >
              <span className="tree__icon" aria-hidden>
                <Icon size={17} />
              </span>
              <span className="tree__label">{element.name}</span>
              <span className="tree__value">{element.spec.sizeLabel}</span>
            </button>
          </li>
        );
      })}
      {elements.length > MAX_ROWS && (
        <li className="muted tree__more" style={indent(level)}>
          … mais {elements.length - MAX_ROWS} elemento(s). Use a busca para localizá-los.
        </li>
      )}
    </>
  );

  // Arquitetura: pavimento › categoria › elemento (portas e janelas no pavimento da hospedeira).
  const archBranch = (
    <Branch
      id="architecture"
      level={1}
      label="Arquitetura"
      icon={<House size={17} />}
      count={archCount}
      open={isOpen('architecture')}
      onToggle={toggle}
      testId="nav-architecture"
    >
      {archTotal === 0 && (
        <li className="muted tree__more" style={indent(2)} data-testid="nav-arch-empty">
          Nenhum elemento de arquitetura. No ambiente Arquitetura, use Modelagem › Parede.
        </li>
      )}
      {archTotal > 0 && archCount === 0 && (
        <li className="muted tree__more" style={indent(2)}>
          Nenhum elemento de arquitetura corresponde à busca.
        </li>
      )}
      {archTree.map((floor) => {
        const floorId = `arch:${floor.levelId ?? 'none'}`;
        return (
          <Branch
            key={floorId}
            id={floorId}
            level={2}
            label={floor.name}
            icon={<Layers2 size={17} />}
            count={floor.count}
            open={isOpen(floorId)}
            onToggle={toggle}
            testId="nav-arch-level"
          >
            {floor.categories.map((category) => {
              const id = `${floorId}:${category.kind}`;
              const Icon = ARCH_ICONS[category.kind];
              return (
                <Branch
                  key={id}
                  id={id}
                  level={3}
                  label={category.label}
                  icon={<Icon size={17} />}
                  count={category.items.length}
                  open={isOpen(id)}
                  onToggle={toggle}
                  testId={`nav-arch-${category.kind}`}
                >
                  {category.items.slice(0, MAX_ROWS).map(({ element, detail }) => {
                    const active = archSelected.has(element.id);
                    return (
                      <li key={element.id}>
                        <button
                          type="button"
                          data-testid="arch-item"
                          data-arch-id={element.id}
                          data-arch-kind={element.kind}
                          aria-pressed={active}
                          className={
                            active
                              ? 'tree__row tree__row--leaf is-active'
                              : 'tree__row tree__row--leaf'
                          }
                          style={indent(4)}
                          title={`${element.name}${detail ? ` · ${detail}` : ''} · ${floor.name}\nCtrl+clique para selecionar vários`}
                          onClick={(event) =>
                            useArchStore
                              .getState()
                              .select(element.id, event.ctrlKey || event.metaKey || event.shiftKey)
                          }
                        >
                          <span className="tree__icon" aria-hidden>
                            <Icon size={17} />
                          </span>
                          <span className="tree__label">{element.name}</span>
                          {element.kind === 'space' && (
                            <span className="tree__value">{detail}</span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                  {category.items.length > MAX_ROWS && (
                    <li className="muted tree__more" style={indent(4)}>
                      … mais {category.items.length - MAX_ROWS} elemento(s). Use a busca.
                    </li>
                  )}
                </Branch>
              );
            })}
          </Branch>
        );
      })}
    </Branch>
  );

  return (
    <div className="browser" data-testid="project-browser">
      <header className="panel__header browser__header">
        <h2>Projeto</h2>
      </header>
      <div className="browser__search-wrap">
        <label className="browser__search">
          <Search size={15} aria-hidden />
          <span className="visually-hidden">Localizar elemento</span>
          <input
            type="search"
            data-testid="nav-search"
            placeholder="Buscar no projeto…"
            title="Buscar por nome, tipo, diâmetro ou sistema"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => event.stopPropagation()}
          />
        </label>
        {searching && (
          <span className="browser__results" data-testid="nav-search-count">
            {matching.length + archCount} elemento(s) encontrado(s)
          </span>
        )}
      </div>

      <div className="panel__scroll browser__tree">
        <div className="tree__row tree__row--root" style={indent(0)} title={project.name}>
          <span className="tree__icon" aria-hidden>
            {infra ? (
              <Network size={17} />
            ) : project.discipline === 'architecture' ? (
              <House size={17} />
            ) : (
              <Building2 size={17} />
            )}
          </span>
          <span className="tree__label">{project.name}</span>
          <span className="browser__discipline">
            {DISCIPLINE_LABELS[project.discipline].toUpperCase()}
          </span>
        </div>
        <ul className="tree">
          <Branch
            id="levels"
            level={1}
            label="Pavimentos"
            icon={<Layers2 size={17} />}
            count={project.levels.length}
            open={isOpen('levels')}
            onToggle={toggle}
            testId="nav-levels"
          >
            {project.levels.length === 0 && (
              <li className="muted tree__more" style={indent(2)}>
                Nenhum nível. Crie em Gerenciar › Níveis.
              </li>
            )}
            {project.levels.map((level) => {
              const active = Math.abs(level.elevation - workPlaneZ) < 1e-9;
              return (
                <li key={level.id}>
                  <button
                    type="button"
                    className={
                      active ? 'tree__row tree__row--leaf is-current' : 'tree__row tree__row--leaf'
                    }
                    style={indent(2)}
                    data-testid="nav-level"
                    aria-pressed={active}
                    title={
                      active
                        ? 'Plano de trabalho atual'
                        : 'Usar este nível como plano de trabalho das ferramentas'
                    }
                    onClick={() => actions().setWorkPlaneZ(level.elevation)}
                  >
                    <span className="tree__icon" aria-hidden>
                      <Layers2 size={16} />
                    </span>
                    <span className="tree__label">{level.name}</span>
                    <span className="tree__value">{formatMeters(level.elevation, 2)}</span>
                  </button>
                </li>
              );
            })}
          </Branch>

          {archBranch}

          <Branch
            id="systems"
            level={1}
            label="Sistemas"
            icon={isOpen('systems') ? <FolderOpen size={17} /> : <Folder size={17} />}
            count={project.systems.length}
            open={isOpen('systems')}
            onToggle={toggle}
            testId="nav-systems"
          >
            {project.elements.length === 0 && (
              <li className="muted tree__more" style={indent(2)} data-testid="nav-empty">
                O projeto ainda não tem elementos. Use Modelagem › Tubos para começar.
              </li>
            )}
            {project.elements.length > 0 && matching.length === 0 && (
              <li className="muted tree__more" style={indent(2)} data-testid="nav-no-match">
                Nenhum elemento corresponde à busca.
              </li>
            )}
            {project.systems.map((system) => {
              const elements = bySystem.get(system.id) ?? [];
              const visible = system.visible !== false;
              const open = isOpen(system.id);
              if (searching && elements.length === 0) return null;
              return (
                <li
                  key={system.id}
                  className={visible ? 'tree__branch' : 'tree__branch is-hidden'}
                  data-testid="nav-system"
                  data-system-id={system.id}
                >
                  <div className="tree__row tree__row--branch tree__row--system" style={indent(2)}>
                    <button
                      type="button"
                      className="tree__caret"
                      data-testid="nav-system-toggle"
                      aria-expanded={open}
                      aria-label={open ? `Recolher ${system.name}` : `Expandir ${system.name}`}
                      onClick={() => toggle(system.id)}
                    >
                      {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </button>
                    <span className="tree__icon" style={{ color: system.color }} aria-hidden>
                      {open ? <FolderOpen size={17} /> : <Folder size={17} />}
                    </span>
                    <button
                      type="button"
                      className="tree__label tree__label--button"
                      data-testid="nav-system-name"
                      aria-expanded={open}
                      title={`${system.name} · ${SYSTEM_KIND_LABELS[system.kind]}`}
                      onClick={() => toggle(system.id)}
                    >
                      {system.name}
                    </button>
                    <span className="tree__count">{elements.length}</span>
                    <button
                      type="button"
                      className="tree__action"
                      data-testid="nav-system-select"
                      disabled={elements.length === 0}
                      aria-label={`Selecionar os elementos de ${system.name}`}
                      title="Selecionar os elementos listados deste sistema"
                      onClick={() => actions().selectMany(elements.map((e) => e.id))}
                    >
                      <MousePointerClick size={16} />
                    </button>
                    <button
                      type="button"
                      className={visible ? 'tree__action' : 'tree__action is-off'}
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
                      {visible ? <Eye size={16} /> : <EyeOff size={16} />}
                    </button>
                  </div>
                  {open && (
                    <ul className="tree__children">
                      {SYSTEM_CATEGORIES.map((category) => {
                        const items = elements.filter((e) => category.kinds.includes(e.kind));
                        if (items.length === 0) return null;
                        const id = `${system.id}:${category.id}`;
                        const Icon = category.icon;
                        return (
                          <Branch
                            key={category.id}
                            id={id}
                            level={3}
                            label={category.label}
                            icon={<Icon size={17} />}
                            count={items.length}
                            open={isOpen(id)}
                            onToggle={toggle}
                          >
                            {elementRows(items, 4)}
                          </Branch>
                        );
                      })}
                    </ul>
                  )}
                </li>
              );
            })}
          </Branch>

          <Branch
            id="equipment"
            level={1}
            label="Equipamentos"
            icon={<ELEMENT_ICONS.pump size={17} />}
            count={pumps.length}
            open={isOpen('equipment')}
            onToggle={toggle}
            testId="nav-equipment"
          >
            {pumps.length === 0 && (
              <li className="muted tree__more" style={indent(2)}>
                {searching ? 'Nenhuma bomba na busca.' : 'Nenhuma bomba no projeto.'}
              </li>
            )}
            {elementRows(pumps, 2)}
          </Branch>

          <Branch
            id="tanks"
            level={1}
            label="Reservatórios"
            icon={<ELEMENT_ICONS.tank size={17} />}
            count={tanks.length}
            open={isOpen('tanks')}
            onToggle={toggle}
            testId="nav-tanks"
          >
            {tanks.length === 0 && (
              <li className="muted tree__more" style={indent(2)}>
                {searching ? 'Nenhum reservatório na busca.' : 'Nenhum reservatório no projeto.'}
              </li>
            )}
            {elementRows(tanks, 2)}
          </Branch>

          <Branch
            id="references"
            level={1}
            label="Referências"
            icon={<Mountain size={17} />}
            open={isOpen('references')}
            onToggle={toggle}
            testId="nav-references"
          >
            <li>
              <button
                type="button"
                className="tree__row tree__row--leaf"
                style={indent(2)}
                data-testid="nav-reference-terrain"
                title="Terreno do projeto: resumo e procedência (Gerenciar › Terreno)"
                onClick={() => getCommand('manage.terrain').run()}
              >
                <span className="tree__icon" aria-hidden>
                  <Mountain size={16} />
                </span>
                <span className="tree__label">Terreno</span>
                <span className="tree__value">
                  {project.terrain ? 'superfície' : 'sem superfície'}
                </span>
              </button>
            </li>
            <EarthworkNavRows indent={indent(3)} />

            <li>
              <button
                type="button"
                className="tree__row tree__row--leaf"
                style={indent(2)}
                data-testid="nav-reference-georeference"
                title="Sistema de referência e origem do modelo (Gerenciar › Georreferência)"
                onClick={() => getCommand('manage.georeference').run()}
              >
                <span className="tree__icon" aria-hidden>
                  <Globe2 size={16} />
                </span>
                <span className="tree__label">Georreferência</span>
                <span className="tree__value">
                  {project.georeference ? 'informada' : 'não informada'}
                </span>
              </button>
            </li>
          </Branch>
        </ul>
      </div>

      <section className="browser__views-section" data-testid="nav-views" aria-label="Vistas">
        <h3 className="browser__heading">Vistas</h3>
        <div className="browser__views">
          <CommandButton
            id="view.plan"
            context={context}
            variant="small"
            label={PLAN_LABELS[project.discipline]}
            testId="nav-view-plan"
          />
          <CommandButton id="view.model" context={context} variant="small" testId="nav-view-3d" />
          <CommandButton
            id="analysis.profile"
            context={context}
            variant="small"
            label="Perfil longitudinal…"
            testId="nav-view-profile"
          />
        </div>
        {/* Vistas salvas no projeto: plantas, cortes, elevações e vistas 3D. */}
        <ViewNavigator />
      </section>
      <div className="browser__footer" data-testid="nav-summary">
        <span>{project.elements.length} elementos</span>
        {archTotal > 0 && <span data-testid="nav-arch-count">{archTotal} de arquitetura</span>}
        <span>{selection.length + archSelection.length} selecionados</span>
      </div>
    </div>
  );
}
