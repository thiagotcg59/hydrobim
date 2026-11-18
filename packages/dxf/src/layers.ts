import type { Project } from '@hydrobim/core';
import { aciFromHex, type DxfDocument } from './writer';

const LAYER_PREFIX = 'HB-';
const FALLBACK_LAYER = 'HB-MODELO';

/**
 * Uma camada por sistema hidráulico (`HB-<NOME DO SISTEMA>`), com a cor ACI mais próxima da
 * cor do sistema. `includeHidden` registra as camadas dos sistemas ocultos como desligadas.
 */
export function systemLayers(
  doc: DxfDocument,
  project: Project,
  includeHidden = false,
): { of: (systemId: string) => string } {
  const bySystem = new Map<string, string>();
  for (const system of project.systems) {
    const hidden = system.visible === false;
    if (hidden && !includeHidden) continue;
    bySystem.set(
      system.id,
      doc.addLayer(`${LAYER_PREFIX}${system.name}`, system.color ? aciFromHex(system.color) : 7, {
        off: hidden,
      }),
    );
  }
  let fallback: string | null = null;
  return {
    of: (systemId) => {
      const layer = bySystem.get(systemId);
      if (layer) return layer;
      fallback ??= doc.addLayer(FALLBACK_LAYER, 7);
      return fallback;
    },
  };
}
