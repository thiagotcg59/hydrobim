import type { SystemKind, ValveType } from '@hydrobim/core';
import type { ToolId } from '../state/editorStore';

export const VALVE_TYPE_LABELS: Record<ValveType, string> = {
  gate: 'Gaveta',
  globe: 'Globo',
  ball: 'Esfera',
  butterfly: 'Borboleta',
  check: 'Retenção',
  airRelease: 'Ventosa',
  pressureReducing: 'Redutora de pressão',
  strainer: 'Filtro Y',
  flowMeter: 'Medidor de vazão',
};

export const SYSTEM_KIND_LABELS: Record<SystemKind, string> = {
  domesticColdWater: 'Água fria predial',
  domesticHotWater: 'Água quente predial',
  fireProtection: 'Combate a incêndio',
  waterSupply: 'Abastecimento de água',
  other: 'Outro',
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
  connect: 'Alinhar e conectar',
  move: 'Mover',
  dimension: 'Cota',
  text: 'Texto',
  leader: 'Chamada',
  tag: 'Etiqueta',
};

export const TOOL_HINTS: Record<ToolId, string> = {
  select:
    'Clique em um elemento para selecioná-lo ou arraste uma janela em volta dos elementos (Ctrl/Shift soma à seleção). Tubo selecionado: arraste a alça da extremidade para esticar ou encolher. Setas: deslizam a peça ao longo da linha (Shift ×10, Ctrl ÷10). Botão direito numa extremidade livre: criar tubo. Órbita: botão do meio ou Alt + arrastar.',
  pipe: 'Clique o ponto inicial e o final. Shift: trava o trecho a 0°, 45° ou 90° (no 3D, apontando para cima ou para baixo, trecho vertical). Esc: encerrar. Partindo da extremidade de um tubo, o joelho é criado automaticamente. Começando ou terminando sobre um tubo existente, o tê é inserido automaticamente.',
  elbow: 'Clique em uma extremidade livre para acoplar o joelho.',
  tee: 'Clique sobre um tubo para inserir em linha, ou em uma extremidade livre.',
  reducer: 'Clique em uma extremidade livre para acoplar a redução.',
  valve: 'Clique sobre um tubo para inserir em linha, ou em uma extremidade livre.',
  pump: 'Clique um ponto do plano de trabalho (ou informe as coordenadas) para posicionar a bomba; ou clique em uma extremidade livre para acoplar a sucção.',
  tank: 'Clique um ponto do plano de trabalho (ou informe as coordenadas) para posicionar o reservatório.',
  measure: 'Clique dois pontos para medir a distância.',
  connect:
    'Clique a extremidade livre do trecho e, em seguida, a porta de referência (bocal do equipamento ou de outra peça). Escolha a alternativa no painel: alinhar move o trecho; conectar completa a montagem e registra a ligação. O equipamento fica fixo. Esc: recomeçar.',
  move: 'Clique o ponto-base (uma porta ou um ponto do elemento) e, em seguida, o destino; a prévia mostra o resultado antes do clique. Sobre um ponto do plano o deslocamento é horizontal; para mudar a cota, capture uma porta ou use Shift (vertical). Tubos ligados se ajustam quando o acoplamento permite; senão, marque "Levar a rede ligada". Esc: outro ponto-base; Esc de novo: sair.',
  dimension: 'Clique os dois pontos a cotar e, em seguida, a posição da linha de cota.',
  text: 'Clique na planta para posicionar o texto e digite o conteúdo.',
  leader: 'Clique o ponto indicado e, em seguida, a posição do texto da chamada.',
  tag: 'Clique em um elemento e, em seguida, a posição da etiqueta.',
};

/** Orientações das ferramentas de modelagem quando usadas na planta baixa. */
export const PLAN_TOOL_HINTS: Partial<Record<ToolId, string>> = {
  pipe: 'Clique o ponto inicial e os seguintes: o eixo fica na elevação indicada. Para subir ou descer, altere a elevação do eixo durante o traçado (cria a prumada). Começando ou terminando sobre um tubo existente, o tê é inserido automaticamente. Esc: encerrar.',
  pump: 'Clique um ponto da planta para posicionar a bomba no nível ativo; ou clique em uma extremidade livre para acoplar a sucção.',
  tank: 'Clique um ponto da planta para posicionar o reservatório no nível ativo.',
  move: 'Clique o ponto-base e, em seguida, o destino; a prévia mostra o resultado. Na planta o deslocamento é horizontal (a cota se altera no painel de propriedades), exceto ao capturar uma porta. Esc: outro ponto-base; Esc de novo: sair.',
};
