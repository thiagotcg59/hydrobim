import {
  formatMeters,
  georeferenceStatus,
  localToProjected,
  projectEarthworks,
  terrainStats,
  type Platform,
  type Project,
  type Terrain,
} from '@hydrobim/core';
import { ArrowLeft, Hexagon, Mountain } from 'lucide-react';
import { useEditorStore } from '../state/editorStore';
import { NumberField, ReadOnlyRow, Section, TextField } from '../ui/fields';
import { changePlatform, deletePlatform, renameSurface, useEarthworkStore } from './earthworkStore';

/**
 * Propriedades da superfície do terreno e dos platôs no painel de propriedades do editor (o
 * mesmo dos elementos da rede): identificação, medidas, procedência e referenciais do terreno;
 * parâmetros e quantidades do platô.
 */

const nf = (value: number, digits = 2): string =>
  value.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits });

const area = (m2: number): string => (m2 >= 10_000 ? `${nf(m2 / 10_000)} ha` : `${nf(m2, 1)} m²`);
const m3 = (value: number | null | undefined): string =>
  value === null || value === undefined ? 'pendente' : `${nf(value)} m³`;
const PENDING = <em className="muted">não informado</em>;

function SurfaceProperties({ terrain, project }: { terrain: Terrain; project: Project }) {
  const stats = terrainStats(terrain);
  const geo = georeferenceStatus(project.georeference);
  const { georeference } = project;
  const { source } = terrain;
  const corner = (x: number, y: number): string => {
    if (!georeference) return `X ${nf(x)}; Y ${nf(y)}`;
    const projected = localToProjected(georeference, { x, y });
    return `E ${nf(projected.e)}; N ${nf(projected.n)}`;
  };
  return (
    <>
      <Section title="Identificação" testId="terrain-props-identity">
        <TextField
          label="Nome"
          value={terrain.name}
          testId="terrain-prop-name"
          onCommit={(name) => renameSurface({ name })}
        />
        <TextField
          label="Identificação"
          value={terrain.tag}
          testId="terrain-prop-tag"
          onCommit={(tag) => renameSurface({ tag })}
        />
        <ReadOnlyRow label="Classe IFC" value="IfcGeographicElement · TERRAIN" />
        <ReadOnlyRow
          label="Situação"
          value={
            <span data-testid="terrain-prop-state">
              {terrain.original ? 'editada (original guardada)' : 'como importada'}
            </span>
          }
        />
      </Section>
      <Section title="Medidas" testId="terrain-props-measures">
        <ReadOnlyRow
          label="Área em planta"
          value={<span data-testid="terrain-prop-area">{area(stats.planArea)}</span>}
        />
        <ReadOnlyRow label="Área da superfície" value={area(stats.surfaceArea)} />
        <ReadOnlyRow
          label="Cota mínima"
          value={<span data-testid="terrain-prop-min">{formatMeters(stats.minZ, 3)}</span>}
        />
        <ReadOnlyRow
          label="Cota máxima"
          value={<span data-testid="terrain-prop-max">{formatMeters(stats.maxZ, 3)}</span>}
        />
        <ReadOnlyRow
          label="Vértices · triângulos"
          value={`${stats.vertexCount.toLocaleString('pt-BR')} · ${stats.triangleCount.toLocaleString('pt-BR')}`}
        />
        <ReadOnlyRow label="Declividade média" value={`${nf(stats.meanSlope * 100, 1)} %`} />
      </Section>
      <Section title="Origem dos dados" testId="terrain-props-source">
        <ReadOnlyRow
          label="Tipo"
          value={
            source.kind === 'survey' ? 'Levantamento topográfico' : 'Modelo digital de elevação'
          }
        />
        <ReadOnlyRow
          label="Fonte"
          value={<span data-testid="terrain-prop-provider">{source.provider}</span>}
        />
        <ReadOnlyRow label="Conjunto de dados" value={source.dataset ?? PENDING} />
        <ReadOnlyRow label="Obtido em" value={source.acquiredAt?.slice(0, 10) ?? PENDING} />
        <ReadOnlyRow
          label="Resolução"
          value={source.resolution === null ? PENDING : `${nf(source.resolution)} m`}
        />
        <ReadOnlyRow
          label="Exatidão altimétrica"
          value={source.verticalAccuracy === null ? PENDING : `${nf(source.verticalAccuracy)} m`}
        />
      </Section>
      <Section title="Coordenadas e referência" testId="terrain-props-reference">
        <ReadOnlyRow
          label="Sistema horizontal"
          value={
            <span data-testid="terrain-prop-crs">
              {georeference
                ? `${georeference.crsName}${georeference.epsg ? ` (EPSG:${georeference.epsg})` : ''}`
                : 'coordenadas locais (projeto sem georreferência)'}
            </span>
          }
        />
        <ReadOnlyRow
          label="Referência altimétrica"
          value={georeference?.verticalDatum ?? source.verticalDatum ?? PENDING}
        />
        <ReadOnlyRow label="Canto inferior esquerdo" value={corner(stats.minX, stats.minY)} />
        <ReadOnlyRow label="Canto superior direito" value={corner(stats.maxX, stats.maxY)} />
        <ReadOnlyRow
          label="Extensão"
          value={`${nf(stats.maxX - stats.minX)} m × ${nf(stats.maxY - stats.minY)} m`}
        />
        {geo.state !== 'ready' && georeference && <span className="muted">{geo.message}</span>}
      </Section>
    </>
  );
}

function PlatformProperties({ platform, project }: { platform: Platform; project: Project }) {
  const entry = projectEarthworks(project)?.platforms.find((p) => p.platform.id === platform.id);
  const q = entry?.quantities ?? null;
  return (
    <>
      <Section title="Platô" testId="platform-props">
        <TextField
          label="Nome"
          value={platform.name}
          testId="platform-prop-name"
          onCommit={(name) => changePlatform(platform.id, { name })}
        />
        <NumberField
          label="Cota de implantação"
          unit="m"
          value={platform.elevation}
          testId="platform-prop-elevation"
          onCommit={(elevation) => changePlatform(platform.id, { elevation })}
        />
        <NumberField
          label="Talude de corte (H:V)"
          value={platform.cutSlope}
          testId="platform-prop-cut"
          title="Metros na horizontal por metro na vertical"
          onCommit={(cutSlope) => changePlatform(platform.id, { cutSlope })}
        />
        <NumberField
          label="Talude de aterro (H:V)"
          value={platform.fillSlope}
          testId="platform-prop-fill"
          title="Metros na horizontal por metro na vertical"
          onCommit={(fillSlope) => changePlatform(platform.id, { fillSlope })}
        />
        <ReadOnlyRow label="Área do platô" value={area(entry?.area ?? 0)} />
        <ReadOnlyRow label="Vértices do perímetro" value={platform.outline.length} />
        <ReadOnlyRow label="Classes IFC" value="IfcEarthworksCut · IfcEarthworksFill" />
        <button
          type="button"
          className="chip"
          data-testid="platform-prop-remove"
          onClick={() => deletePlatform(platform.id)}
        >
          Remover platô
        </button>
      </Section>
      <Section title="Terraplenagem" testId="platform-props-quantities">
        {entry?.error ? (
          <span className="warn" data-testid="platform-prop-error">
            Não gerado: {entry.error.message}
          </span>
        ) : (
          <>
            <ReadOnlyRow
              label="Corte (in situ)"
              value={<span data-testid="platform-prop-cut-volume">{m3(q?.cut)}</span>}
            />
            <ReadOnlyRow
              label="Aterro (compactado)"
              value={<span data-testid="platform-prop-fill-volume">{m3(q?.fill)}</span>}
            />
            <ReadOnlyRow label="Área em corte" value={area(q?.cutArea ?? 0)} />
            <ReadOnlyRow label="Área em aterro" value={area(q?.fillArea ?? 0)} />
            <ReadOnlyRow label="Escavado solto" value={m3(q?.loose)} />
            <ReadOnlyRow label="Saldo (compactado)" value={m3(q?.balance)} />
          </>
        )}
      </Section>
    </>
  );
}

export function EarthworkProperties() {
  const selection = useEarthworkStore((s) => s.selection);
  const project = useEditorStore((s) => s.project);
  const { terrain } = project;
  const platform =
    selection?.kind === 'platform'
      ? project.earthworks.platforms.find((p) => p.id === selection.id)
      : undefined;
  const Icon = platform ? Hexagon : Mountain;
  return (
    <aside className="panel inspector" aria-label="Propriedades" data-testid="properties-panel">
      <header className="panel__header inspector__header">
        <span className="inspector__identity-icon" aria-hidden>
          <Icon size={23} strokeWidth={1.5} />
        </span>
        <div className="inspector__identity">
          <span className="inspector__type" data-testid="properties-type">
            {platform ? 'Platô' : 'Superfície topográfica'}
          </span>
          <h2 data-testid="properties-title">{platform?.name ?? terrain?.name ?? ''}</h2>
        </div>
        <button
          type="button"
          className="inspector__back"
          data-testid="back-to-project"
          aria-label="Ver projeto"
          title="Limpar a seleção e ver o resumo do projeto"
          onClick={() => useEarthworkStore.getState().select(null)}
        >
          <ArrowLeft size={15} aria-hidden />
        </button>
      </header>
      <span className="panel__scope panel__scope--single" data-testid="properties-scope">
        Seleção única · {platform ? 'Platô' : 'Terreno'}
      </span>
      <div className="panel__scroll">
        {platform ? (
          <PlatformProperties platform={platform} project={project} />
        ) : terrain ? (
          <SurfaceProperties terrain={terrain} project={project} />
        ) : null}
      </div>
    </aside>
  );
}
