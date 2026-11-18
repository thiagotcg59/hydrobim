import { FLANGED_PIPE_FAMILIES, PRODUCT_FAMILIES } from '@hydrobim/catalog';
import { classifyLibrary, type IfcLibraryEntry } from '@hydrobim/ifc';
import { X } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';
import { familiesOf, tankFamiliesOf, useEditorStore } from '../state/editorStore';

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * Mapeamento IFC da biblioteca: cada família (catálogo embutido e famílias do projeto) com
 * a entidade, o tipo predefinido e a entidade de tipo que suas ocorrências recebem. É
 * derivado da classificação de `@hydrobim/ifc` — a mesma usada na exportação.
 */
export function IfcLibraryDialog({ open, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const project = useEditorStore((s) => s.project);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  const { entries, instances } = useMemo(() => {
    const counts = new Map<string, number>();
    for (const element of project.elements)
      if (element.familyId !== null)
        counts.set(element.familyId, (counts.get(element.familyId) ?? 0) + 1);
    return {
      entries: classifyLibrary({
        fittingFamilies: familiesOf(project),
        flangedPipeFamilies: FLANGED_PIPE_FAMILIES,
        tankFamilies: tankFamiliesOf(project),
        productFamilies: PRODUCT_FAMILIES,
      }),
      instances: counts,
    };
  }, [project]);

  const groups = useMemo(() => {
    const result = new Map<string, IfcLibraryEntry[]>();
    for (const entry of entries) {
      const list = result.get(entry.group);
      if (list) list.push(entry);
      else result.set(entry.group, [entry]);
    }
    return [...result.entries()];
  }, [entries]);

  return (
    <dialog
      ref={dialogRef}
      className="dialog dialog--wide"
      data-testid="ifc-library-dialog"
      onClose={onClose}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <header className="dialog__header">
        <h2>Mapeamento IFC da biblioteca</h2>
        <button type="button" className="btn btn--icon" onClick={onClose} aria-label="Fechar">
          <X size={16} />
        </button>
      </header>
      <div className="dialog__body dialog__body--tall">
        <p className="muted">
          {entries.length} famílias classificadas no esquema IFC 4.3. A classificação é aplicada
          automaticamente às ocorrências de cada família e gravada na exportação IFC.
        </p>
        {groups.map(([group, list]) => (
          <section key={group} className="ifc-library" data-testid="ifc-library-group">
            <h3 className="section__title">
              {group} <span className="badge">{list.length}</span>
            </h3>
            <div className="families__table">
              <table>
                <thead>
                  <tr>
                    <th>Família</th>
                    <th>Entidade IFC</th>
                    <th>PredefinedType</th>
                    <th>Tipo IFC</th>
                    <th>Fabricante</th>
                    <th>No projeto</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((entry) => (
                    <tr
                      key={`${group}:${entry.id}`}
                      data-testid="ifc-library-row"
                      data-family-id={entry.id}
                      data-entity={entry.entity}
                      title={entry.note ? `${entry.note}\nFonte: ${entry.source}` : entry.source}
                    >
                      <td>{entry.name}</td>
                      <td>{entry.entity}</td>
                      <td>
                        {entry.predefinedType}
                        {entry.predefinedType === 'USERDEFINED' && ` (${entry.objectType})`}
                      </td>
                      <td>{entry.typeEntity}</td>
                      <td>{entry.manufacturer ?? '—'}</td>
                      <td>{instances.get(entry.id) ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </div>
    </dialog>
  );
}
