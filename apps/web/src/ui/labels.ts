import type { SystemKind, ValveType } from '@hydrobim/core';
import type { SnapKind } from '../editor/picking';
import type { ToolId } from '../state/editorStore';

export const VALVE_TYPE_LABELS: Record<ValveType, string> = {
  gate: 'Gaveta',
  globe: 'Globo',
  ball: 'Esfera',
  butterfly: 'Borboleta',
  check: 'Retenção',
  airRelease: 'Ventosa',
};

export const SYSTEM_KIND_LABELS: Record<SystemKind, string> = {
  domesticColdWater: 'Água fria predial',
  domesticHotWater: 'Água quente predial',
  fireProtection: 'Combate a incêndio',
  waterSupply: 'Abastecimento de água',
  other: 'Outro',
};

export const SNAP_LABELS: Record<SnapKind, string> = {
  port: 'Extremidade livre',
  grid: 'Grade',
  plane: 'Plano de trabalho',
  axis: 'Eixo da porta',
  vertical: 'Vertical',
};

export const TOOL_LABELS: Record<ToolId, string> = {
  select: 'Selecionar',
  pipe: 'Tubulação',
  elbow: 'Joelho',
  tee: 'Tê',
  reducer: 'Redução',
  valve: 'Válvula',
  pump: 'Bomba',
  tank: 'Reservatório',
  measure: 'Medir',
};

export const TOOL_HINTS: Record<ToolId, string> = {
  select: 'Clique em um elemento para selecioná-lo. Arraste para orbitar a câmera.',
  pipe: 'Clique o ponto inicial e o final. Shift: trecho vertical. Esc: encerrar. Partindo da extremidade de um tubo, o joelho é criado automaticamente.',
  elbow: 'Clique em uma extremidade livre para acoplar o joelho.',
  tee: 'Clique sobre um tubo para inserir em linha, ou em uma extremidade livre.',
  reducer: 'Clique em uma extremidade livre para acoplar a redução.',
  valve: 'Clique sobre um tubo para inserir em linha, ou em uma extremidade livre.',
  pump: 'Clique um ponto do plano de trabalho (ou informe as coordenadas) para posicionar a bomba; ou clique em uma extremidade livre para acoplar a sucção.',
  tank: 'Clique um ponto do plano de trabalho (ou informe as coordenadas) para posicionar o reservatório.',
  measure: 'Clique dois pontos para medir a distância.',
};
