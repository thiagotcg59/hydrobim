import {
  Box,
  ChevronsRight,
  CircleDot,
  CornerDownRight,
  Cylinder,
  Eye,
  Fan,
  Maximize,
  MousePointer2,
  Ruler,
  Slash,
  Split,
  SquareArrowUp,
  type LucideIcon,
} from 'lucide-react';
import { useEditorStore, type ToolId, type ViewPreset } from '../state/editorStore';
import { TOOL_LABELS } from './labels';

const TOOLS: { id: ToolId; icon: LucideIcon; shortcut: string }[] = [
  { id: 'select', icon: MousePointer2, shortcut: 'S' },
  { id: 'pipe', icon: Slash, shortcut: 'T' },
  { id: 'elbow', icon: CornerDownRight, shortcut: 'J' },
  { id: 'tee', icon: Split, shortcut: 'E' },
  { id: 'reducer', icon: ChevronsRight, shortcut: 'R' },
  { id: 'valve', icon: CircleDot, shortcut: 'V' },
  { id: 'measure', icon: Ruler, shortcut: 'M' },
];

const VIEWS: { preset: ViewPreset; label: string; icon: LucideIcon }[] = [
  { preset: 'fit', label: 'Enquadrar', icon: Maximize },
  { preset: 'iso', label: 'Perspectiva', icon: Box },
  { preset: 'top', label: 'Planta', icon: SquareArrowUp },
  { preset: 'front', label: 'Elevação', icon: Eye },
];

/** Recursos planejados: exibidos como indisponíveis, sem ação associada. */
const FUTURE: { label: string; phase: string; icon: LucideIcon }[] = [
  { label: 'Bomba', phase: 'Fase 4', icon: Fan },
  { label: 'Reservatório', phase: 'Fase 4', icon: Cylinder },
];

export const TOOL_SHORTCUTS: Record<string, ToolId> = Object.fromEntries(
  TOOLS.map((tool) => [tool.shortcut.toLowerCase(), tool.id]),
);

export function ToolBar() {
  const tool = useEditorStore((s) => s.tool);
  const { setTool, requestView } = useEditorStore.getState();

  return (
    <nav className="toolbar" aria-label="Ferramentas">
      <span className="toolbar__heading">Modelar</span>
      {TOOLS.map(({ id, icon: Icon, shortcut }) => (
        <button
          key={id}
          type="button"
          data-testid={`tool-${id}`}
          className={tool === id ? 'tool is-active' : 'tool'}
          aria-pressed={tool === id}
          title={`${TOOL_LABELS[id]} (${shortcut})`}
          onClick={() => setTool(id)}
        >
          <Icon size={18} />
          <span>{TOOL_LABELS[id]}</span>
        </button>
      ))}

      <span className="toolbar__heading">Visualizar</span>
      {VIEWS.map(({ preset, label, icon: Icon }) => (
        <button
          key={preset}
          type="button"
          data-testid={`view-${preset}`}
          className="tool"
          title={label}
          onClick={() => requestView(preset)}
        >
          <Icon size={18} />
          <span>{label}</span>
        </button>
      ))}

      <span className="toolbar__heading">Em breve</span>
      {FUTURE.map(({ label, phase, icon: Icon }) => (
        <button
          key={label}
          type="button"
          className="tool"
          disabled
          title={`${label}: planejado para a ${phase} (ainda não implementado)`}
        >
          <Icon size={18} />
          <span>{label}</span>
          <span className="badge">{phase}</span>
        </button>
      ))}
    </nav>
  );
}
