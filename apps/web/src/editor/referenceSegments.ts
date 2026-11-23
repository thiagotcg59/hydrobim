import type { Point2 } from '@hydrobim/core';
import type { SnapSegment } from './planSnaps';

/**
 * Fontes de arestas de referência para o motor de capturas da planta, além das do próprio
 * modelo em edição (ex.: objetos IFC importados). Quem tem as arestas se registra; quem
 * resolve a captura só pergunta — as duas partes não se conhecem.
 */
export type ReferenceSegmentSource = (raw: Point2, tolerance: number) => SnapSegment[];

const sources = new Set<ReferenceSegmentSource>();

export function registerReferenceSegments(source: ReferenceSegmentSource): () => void {
  sources.add(source);
  return () => sources.delete(source);
}

/** Arestas de referência à mostra perto do cursor. */
export function referenceSegmentsNear(raw: Point2, tolerance: number): SnapSegment[] {
  const segments: SnapSegment[] = [];
  for (const source of sources) segments.push(...source(raw, tolerance));
  return segments;
}
