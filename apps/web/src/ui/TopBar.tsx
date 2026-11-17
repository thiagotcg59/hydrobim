import { Download, FilePlus2, FolderOpen, Redo2, Save, Undo2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { selectIsDirty, useEditorStore } from '../state/editorStore';
import { confirmDiscard, exportCurrentProject, saveCurrentProject } from '../state/projectActions';

interface Props {
  onOpen: () => void;
}

export function TopBar({ onOpen }: Props) {
  const name = useEditorStore((s) => s.project.name);
  const discipline = useEditorStore((s) => s.project.discipline);
  const dirty = useEditorStore(selectIsDirty);
  const persisted = useEditorStore((s) => s.persisted);
  const saveState = dirty || !persisted ? 'não salvo' : 'salvo';
  const canUndo = useEditorStore((s) => s.past.length > 0);
  const canRedo = useEditorStore((s) => s.future.length > 0);
  const { setProjectName, setDiscipline, newProject, undo, redo } = useEditorStore.getState();
  const [draft, setDraft] = useState(name);
  useEffect(() => setDraft(name), [name]);

  return (
    <header className="topbar">
      <div className="topbar__brand" aria-label="HydroBIM">
        <img src="/favicon.svg" alt="" width={22} height={22} />
        <span>HydroBIM</span>
      </div>

      <label className="topbar__project">
        <span className="visually-hidden">Nome do projeto</span>
        <input
          data-testid="project-name"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => setProjectName(draft.trim() || 'Projeto sem título')}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
            event.stopPropagation();
          }}
        />
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
          {saveState}
        </span>
      </label>

      <div className="topbar__group">
        <button
          type="button"
          className="btn"
          data-testid="action-new"
          onClick={() => {
            if (confirmDiscard()) newProject(discipline);
          }}
        >
          <FilePlus2 size={16} /> Novo
        </button>
        <button type="button" className="btn" data-testid="action-open" onClick={onOpen}>
          <FolderOpen size={16} /> Abrir
        </button>
        <button
          type="button"
          className="btn btn--primary"
          data-testid="action-save"
          onClick={() => void saveCurrentProject()}
          title="Salvar no navegador (Ctrl+S)"
        >
          <Save size={16} /> Salvar
        </button>
        <button
          type="button"
          className="btn"
          data-testid="action-export"
          onClick={exportCurrentProject}
          title="Baixar o projeto como arquivo JSON"
        >
          <Download size={16} /> Exportar JSON
        </button>
        <button
          type="button"
          className="btn"
          disabled
          title="Exportação IFC 4.3: planejada para a Fase 3 (ainda não implementada)"
        >
          Exportar IFC <span className="badge">Fase 3</span>
        </button>
      </div>

      <div className="topbar__group">
        <button
          type="button"
          className="btn btn--icon"
          data-testid="action-undo"
          disabled={!canUndo}
          onClick={undo}
          title="Desfazer (Ctrl+Z)"
          aria-label="Desfazer"
        >
          <Undo2 size={16} />
        </button>
        <button
          type="button"
          className="btn btn--icon"
          data-testid="action-redo"
          disabled={!canRedo}
          onClick={redo}
          title="Refazer (Ctrl+Y)"
          aria-label="Refazer"
        >
          <Redo2 size={16} />
        </button>
      </div>

      <div className="segmented" role="group" aria-label="Ambiente de modelagem">
        {(['mep', 'infra'] as const).map((value) => (
          <button
            key={value}
            type="button"
            data-testid={`environment-${value}`}
            className={discipline === value ? 'segmented__item is-active' : 'segmented__item'}
            aria-pressed={discipline === value}
            onClick={() => setDiscipline(value)}
            title={
              value === 'mep'
                ? 'Instalações prediais, industriais e casas de bombas'
                : 'Redes de distribuição e adutoras'
            }
          >
            {value === 'mep' ? 'MEP' : 'Infra'}
          </button>
        ))}
      </div>
    </header>
  );
}
