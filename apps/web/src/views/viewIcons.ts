import type { ProjectViewKind } from '@hydrobim/core';
import {
  Box,
  Map as MapIcon,
  PanelBottom,
  SquareSplitHorizontal,
  type LucideIcon,
} from 'lucide-react';

/** Símbolo de cada tipo de vista de projeto (navegador e cabeçalho das áreas de desenho). */
export const VIEW_ICONS: Record<ProjectViewKind, LucideIcon> = {
  plan: MapIcon,
  section: SquareSplitHorizontal,
  elevation: PanelBottom,
  '3d': Box,
};
