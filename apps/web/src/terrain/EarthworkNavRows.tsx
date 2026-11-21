import { formatMeters } from '@hydrobim/core';
import { Hexagon, Mountain } from 'lucide-react';
import type { CSSProperties } from 'react';
import { useEditorStore } from '../state/editorStore';
import { useEarthworkStore } from './earthworkStore';

/**
 * Superfície topográfica e platôs no navegador do projeto (sob Referências › Terreno): um
 * clique seleciona o item e mostra as propriedades no painel à direita.
 */
export function EarthworkNavRows({ indent }: { indent: CSSProperties }) {
  const terrain = useEditorStore((s) => s.project.terrain);
  const platforms = useEditorStore((s) => s.project.earthworks.platforms);
  const selection = useEarthworkStore((s) => s.selection);
  if (!terrain) return null;
  const { select } = useEarthworkStore.getState();
  const row = (active: boolean): string =>
    active ? 'tree__row tree__row--leaf is-selected' : 'tree__row tree__row--leaf';
  return (
    <>
      <li>
        <button
          type="button"
          className={row(selection?.kind === 'surface')}
          style={indent}
          data-testid="nav-terrain-surface"
          aria-pressed={selection?.kind === 'surface'}
          title="Superfície topográfica: selecionar e ver as propriedades"
          onClick={() => select(selection?.kind === 'surface' ? null : { kind: 'surface' })}
        >
          <span className="tree__icon" aria-hidden>
            <Mountain size={16} />
          </span>
          <span className="tree__label">{terrain.name || 'Superfície'}</span>
          <span className="tree__value">{terrain.original ? 'editada' : 'TIN'}</span>
        </button>
      </li>
      {platforms.map((platform) => {
        const active = selection?.kind === 'platform' && selection.id === platform.id;
        return (
          <li key={platform.id}>
            <button
              type="button"
              className={row(active)}
              style={indent}
              data-testid="nav-platform"
              data-platform-id={platform.id}
              aria-pressed={active}
              title="Platô: selecionar e ver as propriedades"
              onClick={() => select(active ? null : { kind: 'platform', id: platform.id })}
            >
              <span className="tree__icon" aria-hidden>
                <Hexagon size={16} />
              </span>
              <span className="tree__label">{platform.name}</span>
              <span className="tree__value">Z {formatMeters(platform.elevation, 2)}</span>
            </button>
          </li>
        );
      })}
    </>
  );
}
