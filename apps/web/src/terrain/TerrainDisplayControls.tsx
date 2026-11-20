import { suggestContourInterval } from '@hydrobim/core';
import { Grid3x3, Waves } from 'lucide-react';
import { useEditorStore } from '../state/editorStore';
import { EXAGGERATIONS, useTerrainStore, type TerrainColorMode } from './terrainStore';

const INTERVALS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100] as const;

/**
 * Visualização do terreno (planta e modelo 3D), na aba Visualizar: cor da superfície, curvas
 * de nível e o seu intervalo, arestas da triangulação e escala vertical. São opções de
 * exibição da sessão: não alteram a superfície, o projeto nem as exportações.
 */
export function TerrainDisplayControls() {
  const terrain = useEditorStore((s) => s.project.terrain);
  const display = useTerrainStore((s) => s.display);
  const { setDisplay } = useTerrainStore.getState();
  if (!terrain) {
    return (
      <span className="muted" data-testid="terrain-display-empty">
        Sem superfície de terreno no projeto.
      </span>
    );
  }
  const suggested = suggestContourInterval(terrain);
  const natural = display.exaggeration === 1;
  return (
    <>
      <label className="plan__field">
        <span>Cor (3D)</span>
        <select
          data-testid="terrain-color-mode"
          value={display.colorMode}
          onChange={(event) => setDisplay({ colorMode: event.target.value as TerrainColorMode })}
          title="Cor da superfície no modelo 3D: por altitude (hipsometria), por classes de declividade ou lisa"
        >
          <option value="elevation">Altitude</option>
          <option value="slope">Declividade</option>
          <option value="plain">Lisa</option>
        </select>
      </label>
      <label className="check" title="Mostrar as curvas de nível na planta e no modelo 3D">
        <input
          type="checkbox"
          data-testid="terrain-contours-toggle"
          checked={display.contours}
          onChange={(event) => setDisplay({ contours: event.target.checked })}
        />
        <Waves size={13} /> Curvas
      </label>
      <label className="plan__field">
        <span>a cada</span>
        <select
          data-testid="terrain-contour-interval"
          value={display.contourInterval ?? ''}
          disabled={!display.contours}
          onChange={(event) =>
            setDisplay({
              contourInterval: event.target.value === '' ? null : Number(event.target.value),
            })
          }
          title="Intervalo das curvas de nível. As curvas são a interseção exata com a triangulação: um intervalo mais fino que a exatidão dos dados não acrescenta informação real"
        >
          <option value="">sugerido ({suggested.toLocaleString('pt-BR')} m)</option>
          {INTERVALS.map((value) => (
            <option key={value} value={value}>
              {value.toLocaleString('pt-BR')} m
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className={display.triangulation ? 'btn btn--compact is-active' : 'btn btn--compact'}
        data-testid="terrain-triangulation-toggle"
        aria-pressed={display.triangulation}
        onClick={() => setDisplay({ triangulation: !display.triangulation })}
        title="Mostrar as arestas da triangulação (TIN) na planta e no modelo 3D"
      >
        <Grid3x3 size={14} /> Triangulação
      </button>
      <label
        className="plan__field"
        title="Escala vertical do desenho do terreno no modelo 3D. 1:1 é o terreno natural, em escala real. Acima disso só o terreno é esticado: a rede deixa de coincidir com ele"
      >
        <span>Vertical (3D)</span>
        <select
          data-testid="terrain-exaggeration"
          value={display.exaggeration}
          onChange={(event) => setDisplay({ exaggeration: Number(event.target.value) })}
        >
          {EXAGGERATIONS.map((value) => (
            <option key={value} value={value}>
              {value === 1 ? '1:1 (real)' : `${value}× exagerado`}
            </option>
          ))}
        </select>
      </label>
      <label
        className="plan__field"
        title="Transparência da superfície no modelo 3D: quanto mais transparente, mais visível a rede enterrada"
      >
        <span>Transparência (3D)</span>
        <input
          type="range"
          className="infra__range"
          data-testid="terrain-opacity"
          min={0}
          max={90}
          step={5}
          value={Math.round((1 - display.opacity) * 100)}
          onChange={(event) => setDisplay({ opacity: 1 - Number(event.target.value) / 100 })}
        />
        <span data-testid="terrain-opacity-value">{Math.round((1 - display.opacity) * 100)} %</span>
      </label>
      <button
        type="button"
        className={natural ? 'btn btn--compact is-active' : 'btn btn--compact'}
        data-testid="terrain-natural"
        aria-pressed={natural}
        onClick={() => setDisplay({ exaggeration: 1 })}
        title="Terreno natural: escala real 1:1, sem exagero vertical"
      >
        Terreno natural 1:1
      </button>
      {!natural && (
        <span className="terrain__warning" data-testid="terrain-exaggeration-warning">
          Exagero de {display.exaggeration}× só no desenho do terreno: a rede e as cotas não mudam.
        </span>
      )}
    </>
  );
}
