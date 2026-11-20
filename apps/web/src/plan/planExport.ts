import { encodeDxf, exportPlanDxf } from '@hydrobim/dxf';
import { visibleElementsOf } from '../editor/visibility';
import { downloadText, projectFileBase } from '../persistence/fileIO';
import { useEditorStore } from '../state/editorStore';
import { outlineOf, PAPER } from './planDrawing';

/**
 * Exporta a planta em DXF. Não depende da vista aberta: o desenho é gerado do modelo, com as
 * mesmas dimensões de papel e a mesma projeção (em cache) da planta na tela.
 */
export function exportPlanDxfFile(): void {
  const store = useEditorStore.getState();
  if (visibleElementsOf(store.project).length === 0 && store.project.annotations.length === 0) {
    store.notify('error', 'A planta está vazia: não há o que exportar.');
    return;
  }
  // No Infra, as anotações saem na escala de documentação da Planta Infra.
  const current =
    store.project.discipline === 'infra'
      ? { ...store.project, drawingScale: store.project.infra.drawingScale }
      : store.project;
  try {
    const text = exportPlanDxf(current, {
      paper: PAPER,
      outline: (element) => outlineOf(element).outline,
    });
    downloadText(`${projectFileBase(current)}-planta.dxf`, encodeDxf(text), 'application/dxf');
    store.notify(
      'success',
      `Planta exportada em DXF (R2000): desenho em metros, camadas REDE_*, anotações para plotagem em 1:${current.drawingScale}.`,
    );
  } catch (error) {
    console.error('[HydroBIM] Falha na exportação DXF da planta.', error);
    store.notify('error', 'Não foi possível exportar a planta em DXF.');
  }
}
