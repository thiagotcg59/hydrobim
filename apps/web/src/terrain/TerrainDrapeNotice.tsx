import { findBasemapProvider } from '../map/providers';
import { useEditorStore } from '../state/editorStore';
import { CutFillLegend } from './EarthworkPanel';
import { SURFACE_VIEW_LABELS, useEarthworkStore } from './earthworkStore';
import { useTerrainStore } from './terrainStore';

/**
 * Avisos do terreno sobre o modelo 3D: a situação e a atribuição do mapa estendido sobre a
 * superfície (a atribuição é exigida pelas licenças das fontes e fica visível sempre que a
 * imagem está à mostra) e, havendo platôs, qual superfície está à mostra, com a legenda de
 * corte e aterro na comparação.
 */
export function TerrainDrapeNotice() {
  const drape = useTerrainStore((s) => s.drape);
  const sourceId = useTerrainStore((s) => s.display.drapeSourceId);
  const customBasemap = useEditorStore((s) => s.customBasemap);
  const hasTerrain = useEditorStore((s) => s.project.terrain !== null);
  const hasPlatforms = useEditorStore((s) => s.project.earthworks.platforms.length > 0);
  const view = useEarthworkStore((s) => s.view);
  const provider = findBasemapProvider(sourceId, customBasemap);
  if (!hasTerrain) return null;
  const shown = drape !== null && (drape.state === 'ready' || drape.state === 'partial');
  const showSurface = hasPlatforms || view === 'original';
  if (!drape && !showSurface) return null;
  return (
    <>
      {showSurface && (
        <div className="earthwork-notice" data-testid="earthwork-3d-notice" data-view={view}>
          <span>Terreno: {SURFACE_VIEW_LABELS[view].toLowerCase()}</span>
          {view === 'compare' && <CutFillLegend />}
        </div>
      )}
      {drape && (
        <div className="terrain-drape" data-testid="terrain-drape" data-state={drape.state}>
          {drape.message && <span>{drape.message}</span>}
          {shown && provider && (
            <span className="terrain-drape__attribution" data-testid="terrain-drape-attribution">
              <a href={provider.attributionUrl} target="_blank" rel="noreferrer noopener">
                {provider.attribution}
              </a>
              {' · '}
              <a href={provider.licenseUrl} target="_blank" rel="noreferrer noopener">
                {provider.license}
              </a>
              {provider.resolution !== null && ` · resolução ≈ ${provider.resolution} m`}
              {' · imagem de referência: as cotas são as da superfície'}
            </span>
          )}
        </div>
      )}
    </>
  );
}
