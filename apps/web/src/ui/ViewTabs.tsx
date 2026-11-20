import { useCommandContext } from '../commands/useCommands';
import { useEditorStore } from '../state/editorStore';
import { CommandButton } from './CommandButton';

/**
 * Abas de vista, em posição fixa sobre a área de desenho, e os controles de navegação. A vista
 * é independente da aba de tarefa: trocar entre o modelo 3D e a planta mantém a ferramenta, o
 * trecho em andamento, a seleção e o ponto observado.
 */
export function ViewTabs() {
  const context = useCommandContext();
  const infra = useEditorStore((s) => s.project.discipline === 'infra');
  const bim = context.viewMode === 'bim';

  return (
    <div className="viewtabs" data-testid="view-tabs">
      <div className="viewtabs__tabs" role="group" aria-label="Vistas">
        <CommandButton id="view.model" context={context} variant="small" />
        <CommandButton
          id="view.plan"
          context={context}
          variant="small"
          label={infra ? 'Planta Infra' : 'Planta MEP'}
        />
        {infra && (
          // O perfil ainda é um diálogo de análise, não uma vista sincronizada: o botão o abre.
          <CommandButton
            id="analysis.profile"
            context={context}
            variant="small"
            label="Perfil…"
            testId="view-mode-profile"
          />
        )}
        {bim && (
          <span
            className="viewtabs__mode"
            data-testid="bim-mode-badge"
            title="A consulta BIM / IFC usa o Modelo 3D. Escolher a planta ou outra aba de tarefa encerra a consulta e retoma a modelagem."
          >
            Consulta BIM / IFC
          </span>
        )}
      </div>
      <div className="viewtabs__nav" role="group" aria-label="Navegação da vista">
        <CommandButton id="view.fit" context={context} variant="icon" />
        <CommandButton id="view.fitSelection" context={context} variant="icon" />
        <span className="viewtabs__sep" aria-hidden />
        <CommandButton id="view.top" context={context} variant="icon" />
        <CommandButton id="view.front" context={context} variant="icon" />
        <CommandButton id="view.iso" context={context} variant="icon" />
        <CommandButton id="view.isometric" context={context} variant="icon" />
        <CommandButton id="view.ortho" context={context} variant="icon" />
      </div>
    </div>
  );
}
