import type { Point2 } from '@hydrobim/core';
import { memo, useMemo } from 'react';
import { useEditorStore } from '../state/editorStore';
import {
  ghostTransform,
  IFC_2D_LIMIT,
  ifcGhostEntry,
  ifcPlanEntry,
  shownIfcObjects,
  type IfcDrawEntry,
} from './ifcPlan';
import { ifcSourceOf, useIfcStore } from './ifcStore';

/**
 * Modelos IFC importados na planta de trabalho: arestas vivas de cada objeto, vistas de cima.
 * São referência — traço cinza, sem preenchimento; só o traço seleciona, de modo que a rede e
 * a arquitetura por baixo continuam clicáveis.
 */

export const IFC_LINE_COLOR = '#5d6b7a';
export const IFC_SELECTED_COLOR = '#19b6cf';
const GHOST_COLOR = '#1f9d55';

const f = (value: number): string => (Math.round(value * 1e4) / 1e4).toString();

interface ShapeProps {
  entry: IfcDrawEntry;
  origin: Point2;
  objectId?: string;
  selected?: boolean;
  ghost?: boolean;
  opacity?: number;
}

/** Traços de um objeto importado (planta de trabalho e vistas salvas). */
export const IfcShape = memo(function IfcShape({
  entry,
  origin,
  objectId,
  selected = false,
  ghost = false,
  opacity = 1,
}: ShapeProps) {
  const color = ghost ? GHOST_COLOR : selected ? IFC_SELECTED_COLOR : IFC_LINE_COLOR;
  return (
    <g
      data-ifc-id={objectId}
      data-ifc-ghost={ghost || undefined}
      data-selected={selected || undefined}
      transform={`translate(${f(entry.anchor.x - origin.x)} ${f(-(entry.anchor.y - origin.y))})`}
      fill="none"
      opacity={opacity}
    >
      {/* Faixa invisível mais larga: o traço fino continua fácil de clicar. */}
      {objectId && (
        <path
          d={entry.linePath + entry.cutPath}
          stroke="transparent"
          strokeWidth={9}
          vectorEffect="non-scaling-stroke"
          pointerEvents="stroke"
        />
      )}
      <path
        d={entry.linePath}
        stroke={color}
        strokeWidth={selected ? 1.8 : 1}
        strokeDasharray={ghost ? '6 4' : undefined}
        vectorEffect="non-scaling-stroke"
        pointerEvents="none"
      />
      {entry.cutPath && (
        <path
          d={entry.cutPath}
          stroke={color}
          strokeWidth={selected ? 2.6 : 2}
          vectorEffect="non-scaling-stroke"
          pointerEvents="none"
        />
      )}
    </g>
  );
});

interface LayerProps {
  origin: Point2;
  interactive: boolean;
}

export const IfcPlanLayer = memo(function IfcPlanLayer({ origin, interactive }: LayerProps) {
  const models = useEditorStore((s) => s.project.ifcModels);
  const revision = useIfcStore((s) => s.revision);
  const selectionIds = useIfcStore((s) => s.selection);
  const modelSelection = useIfcStore((s) => s.modelSelection);
  const hidden = useIfcStore((s) => s.hidden);
  const wizard = useIfcStore((s) => s.wizard);

  const { drawn, skipped } = useMemo(() => {
    const shown = shownIfcObjects({ ifcModels: models });
    return {
      drawn: shown.slice(0, IFC_2D_LIMIT).flatMap(({ model, object, source }) => {
        const entry = ifcPlanEntry(model, object, source);
        return entry ? [{ model, object, entry }] : [];
      }),
      skipped: Math.max(0, shown.length - IFC_2D_LIMIT),
    };
    // `revision` e `hidden` mudam o que `shownIfcObjects` devolve.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [models, revision, hidden]);

  const placing = wizard?.step === 'placing' ? wizard : null;
  const ghost = useMemo(() => {
    const source = placing?.sha256 ? ifcSourceOf(placing.sha256) : null;
    const transform = ghostTransform();
    if (!placing || !source || !transform) return [];
    return [...placing.selected].slice(0, IFC_2D_LIMIT).flatMap((expressId) => {
      const entry = ifcGhostEntry(source, expressId, transform);
      return entry ? [{ expressId, entry }] : [];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placing?.sha256, placing?.selected, placing?.placement, revision]);

  if (drawn.length === 0 && ghost.length === 0) return null;
  const selection = new Set(selectionIds);
  return (
    <g
      data-layer="ifc-models"
      data-ifc-skipped={skipped || undefined}
      pointerEvents={interactive ? undefined : 'none'}
    >
      {drawn.map(({ model, object, entry }) => (
        <IfcShape
          key={object.id}
          entry={entry}
          origin={origin}
          objectId={object.id}
          selected={modelSelection === model.id || selection.has(object.id)}
          opacity={Math.max(0.25, model.opacity)}
        />
      ))}
      {ghost.length > 0 && (
        <g data-layer="ifc-ghost" pointerEvents="none">
          {ghost.map(({ expressId, entry }) => (
            <IfcShape key={expressId} entry={entry} origin={origin} ghost />
          ))}
        </g>
      )}
    </g>
  );
});

/** Aviso do que ficou fora do desenho 2D pelo limite de objetos. */
export function ifcSkippedNotice(count: number): string {
  return `${count.toLocaleString('pt-BR')} objeto(s) IFC importado(s) não desenhado(s) nesta vista 2D (limite de ${IFC_2D_LIMIT.toLocaleString('pt-BR')}); todos continuam no Modelo 3D.`;
}
