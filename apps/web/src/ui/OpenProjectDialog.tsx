import { FileUp, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProjectSummary } from '../persistence/ProjectRepository';
import {
  confirmDiscard,
  importProjectFile,
  openDemoProject,
  openStoredProject,
  repository,
} from '../state/projectActions';

interface Props {
  open: boolean;
  onClose: () => void;
}

type ListState =
  { status: 'loading' } | { status: 'ready'; projects: ProjectSummary[] } | { status: 'error' };

export function OpenProjectDialog({ open, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [list, setList] = useState<ListState>({ status: 'loading' });

  const refresh = useCallback(async () => {
    setList({ status: 'loading' });
    try {
      setList({ status: 'ready', projects: await repository.list() });
    } catch (error) {
      console.error('[HydroBIM] Falha ao listar projetos.', error);
      setList({ status: 'error' });
    }
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      void refresh();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open, refresh]);

  return (
    <dialog
      ref={dialogRef}
      className="dialog"
      data-testid="open-dialog"
      onClose={onClose}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <header className="dialog__header">
        <h2>Abrir projeto</h2>
        <button type="button" className="btn btn--icon" onClick={onClose} aria-label="Fechar">
          <X size={16} />
        </button>
      </header>

      <div className="dialog__body">
        <h3 className="section__title">Salvos neste navegador</h3>
        {list.status === 'loading' && <p className="muted">Carregando…</p>}
        {list.status === 'error' && (
          <p className="muted">Não foi possível ler o armazenamento local.</p>
        )}
        {list.status === 'ready' && list.projects.length === 0 && (
          <p className="muted">Nenhum projeto salvo ainda.</p>
        )}
        {list.status === 'ready' && list.projects.length > 0 && (
          <ul className="project-list">
            {list.projects.map((project) => (
              <li key={project.id}>
                <button
                  type="button"
                  className="project-list__open"
                  data-testid="stored-project"
                  onClick={async () => {
                    if (!confirmDiscard()) return;
                    if (await openStoredProject(project.id)) onClose();
                  }}
                >
                  <strong>{project.name}</strong>
                  <span className="muted">
                    {project.discipline === 'mep' ? 'MEP' : 'Infra'} · {project.elementCount}{' '}
                    elementos · {new Date(project.updatedAt).toLocaleString('pt-BR')}
                  </span>
                </button>
                <button
                  type="button"
                  className="btn btn--icon"
                  aria-label={`Excluir ${project.name} do navegador`}
                  title="Excluir do navegador"
                  onClick={async () => {
                    if (!window.confirm(`Excluir "${project.name}" do navegador?`)) return;
                    await repository.remove(project.id);
                    await refresh();
                  }}
                >
                  <Trash2 size={15} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <footer className="dialog__footer">
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          hidden
          data-testid="import-file"
          onChange={async (event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (!file || !confirmDiscard()) return;
            if (await importProjectFile(file)) onClose();
          }}
        />
        <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
          <FileUp size={16} /> Importar arquivo JSON…
        </button>
        <button
          type="button"
          className="btn"
          data-testid="open-demo"
          onClick={() => {
            if (!confirmDiscard()) return;
            openDemoProject();
            onClose();
          }}
        >
          Projeto de demonstração
        </button>
      </footer>
    </dialog>
  );
}
