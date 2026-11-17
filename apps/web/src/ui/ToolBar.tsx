import {
  Box,
  ChevronsRight,
  CircleDot,
  CornerDownRight,
  Cylinder,
  Eye,
  Fan,
  Grid3x3,
  Maximize,
  MessageSquare,
  MousePointer2,
  MoveHorizontal,
  Ruler,
  Slash,
  Split,
  SquareArrowUp,
  Tag,
  Type,
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
  { id: 'pump', icon: Fan, shortcut: 'B' },
  { id: 'tank', icon: Cylinder, shortcut: 'Q' },
  { id: 'measure', icon: Ruler, shortcut: 'M' },
];

/** Documentação: atuam na planta baixa (a vista é aberta ao escolher a ferramenta). */
const ANNOTATE: { id: ToolId; icon: LucideIcon; shortcut: string }[] = [
  { id: 'dimension', icon: MoveHorizontal, shortcut: 'C' },
  { id: 'text', icon: Type, shortcut: 'X' },
  { id: 'leader', icon: MessageSquare, shortcut: 'L' },
  { id: 'tag', icon: Tag, shortcut: 'I' },
];

const VIEWS: { preset: ViewPreset; label: string; icon: LucideIcon }[] = [
  { preset: 'fit', label: 'Enquadrar', icon: Maximize },
  { preset: 'iso', label: 'Perspectiva', icon: Box },
  { preset: 'top', label: 'Topo', icon: SquareArrowUp },
  { preset: 'front', label: 'Elevação', icon: Eye },
];

export const TOOL_SHORTCUTS: Record<string, ToolId> = Object.fromEntries(
  [...TOOLS, ...ANNOTATE].map((tool) => [tool.shortcut.toLowerCase(), tool.id]),
);

export function ToolBar() {
  const tool = useEditorStore((s) => s.tool);
  const orthographic = useEditorStore((s) => s.orthographic);
  const { setTool, requestView, setOrthographic } = useEditorStore.getState();

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

      <span className="toolbar__heading">Documentar</span>
      {ANNOTATE.map(({ id, icon: Icon, shortcut }) => (
        <button
          key={id}
          type="button"
          data-testid={`tool-${id}`}
          className={tool === id ? 'tool is-active' : 'tool'}
          aria-pressed={tool === id}
          title={`${TOOL_LABELS[id]} na planta baixa (${shortcut})`}
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

      <button
        type="button"
        data-testid="view-ortho"
        className={orthographic ? 'tool is-active' : 'tool'}
        aria-pressed={orthographic}
        title="Projeção ortográfica (plantas e elevações em verdadeira grandeza)"
        onClick={() => setOrthographic(!orthographic)}
      >
        <Grid3x3 size={18} />
        <span>Ortográfica</span>
      </button>
    </nav>
  );
}
