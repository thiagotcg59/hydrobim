import type { Discipline } from '@hydrobim/core';
import {
  Building2,
  CheckCircle2,
  ChevronDown,
  Circle,
  House,
  Network,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useCommandContext } from '../commands/useCommands';
import type { ProjectSummary } from '../persistence/ProjectRepository';
import { selectIsDirty, useEditorStore } from '../state/editorStore';
import { confirmDiscard, openStoredProject, repository } from '../state/projectActions';
import { CommandButton } from './CommandButton';
import { DISCIPLINE_LABELS } from './labels';

const RECENT_LIMIT = 5;

/**
 * Ambientes do seletor. Trocar de ambiente só muda a disciplina do projeto (as ferramentas à
 * mostra, a especificação e a grade padrão): o modelo, as coordenadas e os elementos — da rede
 * e da arquitetura — são os mesmos nos três.
 */
const ENVIRONMENTS: readonly { value: Discipline; icon: LucideIcon; title: string }[] = [
  {
    value: 'architecture',
    icon: House,
    title:
      'Ambiente Arquitetura: paredes, lajes, pisos, portas, janelas e ambientes. O projeto e os elementos são os mesmos dos outros ambientes.',
  },
  {
    value: 'mep',
    icon: Building2,
    title:
      'Ambiente MEP: instalações prediais, industriais e casas de bombas. Muda a disciplina do projeto (especificação e grade padrão).',
  },
  {
    value: 'infra',
    icon: Network,
    title:
      'Ambiente Infra: redes de distribuição e adutoras. Muda a disciplina do projeto (especificação e grade padrão).',
  },
];

/** Menu Arquivo: novo, abrir, recentes, salvar no navegador e baixar o arquivo nativo. */
function FileMenu() {
  const context = useCommandContext();
  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState<ProjectSummary[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    repository
      .list()
      .then((projects) => {
        if (cancelled) return;
        setRecent(
          [...projects]
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
            .slice(0, RECENT_LIMIT),
        );
      })
      .catch(() => setRecent([]));
    const close = (event: Event): void => {
      if (event.target instanceof Node && ref.current?.contains(event.target)) return;
      setOpen(false);
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      // Esc fecha só o menu: não cancela a operação em andamento nem limpa a seleção.
      event.stopImmediatePropagation();
      setOpen(false);
    };
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      cancelled = true;
      window.removeEventListener('pointerdown', close, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const done = (): void => setOpen(false);

  return (
    <div className="menu" ref={ref}>
      <button
        type="button"
        className="menu__trigger"
        data-testid="menu-file"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        Arquivo <ChevronDown size={14} aria-hidden />
      </button>
      {open && (
        <div
          className="menu__list"
          role="menu"
          data-testid="menu-file-list"
          // As teclas digitadas no menu não são atalhos de ferramenta.
          onKeyDown={(event) => {
            if (event.key !== 'Escape') event.stopPropagation();
          }}
        >
          <CommandButton id="file.new" context={context} variant="menu" onRun={done} />
          <CommandButton id="file.open" context={context} variant="menu" onRun={done} />
          <CommandButton id="file.importIfc" context={context} variant="menu" onRun={done} />
          {recent.length > 0 && (
            <>
              <span className="menu__heading">Salvos neste navegador (recentes)</span>
              {recent.map((project) => (
                <button
                  key={project.id}
                  type="button"
                  role="menuitem"
                  className="cmd cmd--menu"
                  data-testid="recent-project"
                  onClick={async () => {
                    done();
                    if (confirmDiscard()) await openStoredProject(project.id);
                  }}
                >
                  <span className="cmd__text">
                    <strong>{project.name}</strong>
                    <small>
                      {DISCIPLINE_LABELS[project.discipline]} · {project.elementCount} elementos ·{' '}
                      {new Date(project.updatedAt).toLocaleString('pt-BR')}
                    </small>
                  </span>
                </button>
              ))}
            </>
          )}
          <span className="menu__heading">Guardar o trabalho</span>
          <CommandButton
            id="file.save"
            context={context}
            variant="menu"
            label="Salvar no navegador"
            testId="file-save"
            onRun={done}
          />
          <CommandButton id="file.download" context={context} variant="menu" onRun={done} />
          <p className="menu__note">
            <strong>Salvar</strong> guarda o projeto só neste navegador (some se os dados do site
            forem limpos). <strong>Baixar</strong> gera um arquivo seu, que pode ser copiado,
            enviado e aberto em qualquer computador por Arquivo › Abrir. Os demais formatos (IFC,
            DXF, CSV…) ficam na aba Exportação.
          </p>
        </div>
      )}
    </div>
  );
}

/**
 * Cabeçalho: identidade, menu Arquivo, nome do projeto, estado de salvamento, seletor de
 * ambiente (MEP / Infra) e acesso rápido (salvar, desfazer, refazer).
 */
export function TopBar() {
  const context = useCommandContext();
  const name = useEditorStore((s) => s.project.name);
  const discipline = useEditorStore((s) => s.project.discipline);
  const dirty = useEditorStore(selectIsDirty);
  const persisted = useEditorStore((s) => s.persisted);
  const saveState = dirty || !persisted ? 'não salvo' : 'salvo';
  const { setProjectName, setDiscipline } = useEditorStore.getState();
  const [draft, setDraft] = useState(name);
  useEffect(() => setDraft(name), [name]);

  return (
    <header className="topbar">
      <div className="topbar__brand" aria-label="HydroBIM">
        {/* BASE_URL: no GitHub Pages o editor fica em /hydrobim/, não na raiz. */}
        <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" width={22} height={22} />
        <span>HydroBIM</span>
      </div>

      <FileMenu />

      <span className="topbar__rule" aria-hidden />

      <label className="topbar__project">
        <span className="topbar__caption" aria-hidden>
          Projeto:
        </span>
        <span className="visually-hidden">Nome do projeto</span>
        <input
          data-testid="project-name"
          value={draft}
          size={Math.min(Math.max(draft.length, 12), 44)}
          title="Nome do projeto (clique para editar)"
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => setProjectName(draft.trim() || 'Projeto sem título')}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
            event.stopPropagation();
          }}
        />
      </label>

      <span
        className={`topbar__dirty${saveState === 'salvo' ? '' : ' topbar__dirty--on'}`}
        data-testid="dirty-indicator"
        title={
          dirty
            ? 'Há alterações não salvas'
            : persisted
              ? 'Projeto salvo no navegador'
              : 'Projeto ainda não salvo no navegador'
        }
      >
        {saveState === 'salvo' ? (
          <CheckCircle2 size={13} aria-hidden />
        ) : (
          <Circle size={8} fill="currentColor" strokeWidth={0} aria-hidden />
        )}
        <span className="topbar__dirty-label">{saveState}</span>
      </span>

      <div className="topbar__environment">
        <span className="topbar__caption" id="environment-caption">
          Ambiente:
        </span>
        <div className="segmented" role="group" aria-labelledby="environment-caption">
          {ENVIRONMENTS.map(({ value, icon: Icon, title }) => (
            <button
              key={value}
              type="button"
              data-testid={`environment-${value}`}
              className={discipline === value ? 'segmented__item is-active' : 'segmented__item'}
              aria-pressed={discipline === value}
              onClick={() => setDiscipline(value)}
              title={title}
            >
              <Icon size={15} aria-hidden />
              <span className="segmented__label">{DISCIPLINE_LABELS[value]}</span>
            </button>
          ))}
        </div>
      </div>

      <span className="topbar__rule" aria-hidden />

      <div className="topbar__group" role="group" aria-label="Acesso rápido">
        <CommandButton id="file.save" context={context} variant="icon" />
        <CommandButton id="edit.undo" context={context} variant="icon" />
        <CommandButton id="edit.redo" context={context} variant="icon" />
      </div>
    </header>
  );
}
