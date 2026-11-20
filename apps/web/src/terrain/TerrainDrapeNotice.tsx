import { findBasemapProvider } from '../map/providers';
import { useEditorStore } from '../state/editorStore';
import { useTerrainStore } from './terrainStore';

/**
 * Situação e atribuição do mapa estendido sobre o terreno, sobre o modelo 3D. A atribuição é
 * exigida pelas licenças das fontes e fica visível sempre que a imagem está à mostra.
 */
export function TerrainDrapeNotice() {
  const drape = useTerrainStore((s) => s.drape);
  const sourceId = useTerrainStore((s) => s.display.drapeSourceId);
  const customBasemap = useEditorStore((s) => s.customBasemap);
  const hasTerrain = useEditorStore((s) => s.project.terrain !== null);
  const provider = findBasemapProvider(sourceId, customBasemap);
  if (!drape || !hasTerrain) return null;
  const shown = drape.state === 'ready' || drape.state === 'partial';
  return (
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
  );
}
