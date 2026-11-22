import {
  designTerrainOf,
  formatMeters,
  hasDesignTerrain,
  terrainProfile,
  type TerrainProfile,
} from '@hydrobim/core';
import { Download, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { downloadText, projectFileBase } from '../persistence/fileIO';
import { useEditorStore } from '../state/editorStore';
import { useTerrainStore } from './terrainStore';

/**
 * Perfil topográfico do corte traçado na planta. As estacas são as arestas do TIN atravessadas
 * (perfil exato da superfície); fora dela o traço é interrompido. A escala vertical pode ser a
 * real (1:1) ou exagerada só no gráfico — o exagero é sempre indicado.
 */

const nf = (value: number, digits = 2): string =>
  value.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** Exageros verticais do gráfico; `auto` ajusta o desnível à altura disponível. */
const SCALES = ['auto', 1, 2, 5, 10, 20] as const;
type Scale = (typeof SCALES)[number];

const WIDTH = 1000;
const HEIGHT = 230;
const MARGIN = { top: 14, right: 16, bottom: 26, left: 58 };

function niceStep(range: number, ticks: number): number {
  const raw = range / Math.max(ticks, 1);
  const power = 10 ** Math.floor(Math.log10(Math.max(raw, 1e-9)));
  const unit = raw / power;
  return (unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 5 ? 5 : 10) * power;
}

/**
 * Cota de um perfil na distância `chainage`, interpolada entre as estacas (o perfil é exato:
 * entre duas arestas do TIN o terreno é reto); `null` fora da superfície.
 */
export function elevationAlong(profile: TerrainProfile, chainage: number): number | null {
  const { stations } = profile;
  for (let i = 1; i < stations.length; i += 1) {
    const a = stations[i - 1];
    const b = stations[i];
    if (!a || !b || chainage < a.chainage - 1e-9 || chainage > b.chainage + 1e-9) continue;
    if (a.elevation === null || b.elevation === null) {
      if (Math.abs(chainage - a.chainage) < 1e-9 && a.elevation !== null) return a.elevation;
      if (Math.abs(chainage - b.chainage) < 1e-9 && b.elevation !== null) return b.elevation;
      continue;
    }
    const span = b.chainage - a.chainage;
    const t = span > 0 ? (chainage - a.chainage) / span : 0;
    return a.elevation + t * (b.elevation - a.elevation);
  }
  return null;
}

/**
 * Estacas em CSV. Com o terreno natural (havendo platôs), as estacas são as dos dois perfis,
 * com a cota do terreno projetado (TP) e a do natural (TN) em cada uma.
 */
export function profileCsv(profile: TerrainProfile, natural: TerrainProfile | null = null): string {
  if (!natural) {
    const rows = profile.stations.map((s) =>
      [
        s.chainage.toFixed(3),
        s.x.toFixed(3),
        s.y.toFixed(3),
        s.elevation === null ? '' : s.elevation.toFixed(3),
      ].join(';'),
    );
    return `distancia_m;x_m;y_m;cota_m\n${rows.join('\n')}\n`;
  }
  const byChainage = new Map<string, { chainage: number; x: number; y: number }>();
  for (const s of [...profile.stations, ...natural.stations]) {
    const key = s.chainage.toFixed(3);
    if (!byChainage.has(key)) byChainage.set(key, { chainage: s.chainage, x: s.x, y: s.y });
  }
  const cell = (value: number | null): string => (value === null ? '' : value.toFixed(3));
  const rows = [...byChainage.values()]
    .sort((a, b) => a.chainage - b.chainage)
    .map((s) =>
      [
        s.chainage.toFixed(3),
        s.x.toFixed(3),
        s.y.toFixed(3),
        cell(elevationAlong(profile, s.chainage)),
        cell(elevationAlong(natural, s.chainage)),
      ].join(';'),
    );
  return `distancia_m;x_m;y_m;cota_projetado_m;cota_natural_m\n${rows.join('\n')}\n`;
}

/** Faixa de cotas dos perfis à mostra. */
function rangeOf(profiles: readonly (TerrainProfile | null)[]): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const p of profiles) {
    if (!p) continue;
    if (p.minElevation !== null) min = Math.min(min, p.minElevation);
    if (p.maxElevation !== null) max = Math.max(max, p.maxElevation);
  }
  return Number.isFinite(min) && Number.isFinite(max) ? { min, max } : { min: 0, max: 1 };
}

/** Exagero vertical efetivo do gráfico (o desenho escala por igual nas duas direções). */
export function verticalFactor(
  profile: TerrainProfile,
  scale: Scale,
  natural: TerrainProfile | null = null,
): number {
  if (scale !== 'auto') return scale;
  const innerWidth = WIDTH - MARGIN.left - MARGIN.right;
  const innerHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const { min, max } = rangeOf([profile, natural]);
  const relief = Math.max(max - min, 1e-6);
  return (innerHeight * 0.86) / (relief * (innerWidth / profile.length));
}

function Chart({
  profile,
  natural,
  scale,
}: {
  profile: TerrainProfile;
  /** Perfil do terreno natural, quando difere do projetado (há platôs). */
  natural: TerrainProfile | null;
  scale: Scale;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const innerWidth = WIDTH - MARGIN.left - MARGIN.right;
  const innerHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const { min: minZ, max: maxZ } = rangeOf([profile, natural]);
  const relief = Math.max(maxZ - minZ, 1e-6);
  // Unidades do gráfico por metro, na horizontal; a vertical é a horizontal vezes o exagero.
  const perMeter = innerWidth / profile.length;
  const factor = verticalFactor(profile, scale, natural);
  const shown = innerHeight / (perMeter * factor);
  // Com escala fixa o desnível pode não caber: a janela vertical é centrada no relevo.
  const z0 = (minZ + maxZ) / 2 - shown / 2;
  const x = (chainage: number): number => MARGIN.left + chainage * perMeter;
  const y = (z: number): number => MARGIN.top + innerHeight - (z - z0) * perMeter * factor;
  const clipped = !(scale === 'auto') && relief > shown;

  const pathOf = (source: TerrainProfile): string => {
    let d = '';
    let pen = false;
    for (const station of source.stations) {
      if (station.elevation === null) {
        pen = false;
        continue;
      }
      d += `${pen ? 'L' : 'M'}${x(station.chainage).toFixed(2)} ${y(station.elevation).toFixed(2)}`;
      pen = true;
    }
    return d;
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const path = useMemo(() => pathOf(profile), [profile, factor, z0]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const naturalPath = useMemo(() => (natural ? pathOf(natural) : ''), [natural, factor, z0]);

  const stepZ = niceStep(shown, 5);
  const stepX = niceStep(profile.length, 8);
  const levels: number[] = [];
  for (let z = Math.ceil(z0 / stepZ) * stepZ; z <= z0 + shown + 1e-9; z += stepZ) levels.push(z);
  const marks: number[] = [];
  for (let c = 0; c <= profile.length + 1e-9; c += stepX) marks.push(c);

  // Estaca interpolada sob o cursor (entre duas estacas com cota).
  const probe = useMemo(() => {
    if (hover === null) return null;
    const { stations } = profile;
    const naturalAt = natural ? elevationAlong(natural, hover) : null;
    for (let i = 1; i < stations.length; i += 1) {
      const a = stations[i - 1];
      const b = stations[i];
      if (!a || !b || hover < a.chainage || hover > b.chainage) continue;
      if (a.elevation === null || b.elevation === null) {
        return { chainage: hover, elevation: null, natural: naturalAt };
      }
      const span = b.chainage - a.chainage;
      const t = span > 0 ? (hover - a.chainage) / span : 0;
      return {
        chainage: hover,
        elevation: a.elevation + t * (b.elevation - a.elevation),
        grade: span > 0 ? (b.elevation - a.elevation) / span : 0,
        natural: naturalAt,
      };
    }
    return null;
  }, [hover, profile, natural]);

  return (
    <svg
      className="profile terrain-profile__chart"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      role="img"
      aria-label="Perfil topográfico: cota do terreno pela distância ao longo do corte"
      data-testid="terrain-profile-chart"
      data-vertical-factor={factor.toFixed(4)}
      data-clipped={clipped}
      onPointerMove={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const px = ((event.clientX - rect.left) / rect.width) * WIDTH;
        const chainage = (px - MARGIN.left) / perMeter;
        setHover(chainage >= 0 && chainage <= profile.length ? chainage : null);
      }}
      onPointerLeave={() => setHover(null)}
    >
      <defs>
        <clipPath id="terrain-profile-clip">
          <rect x={MARGIN.left} y={MARGIN.top} width={innerWidth} height={innerHeight} />
        </clipPath>
      </defs>
      {levels.map((z) => (
        <g key={z}>
          <line
            className="profile__grid"
            x1={MARGIN.left}
            x2={WIDTH - MARGIN.right}
            y1={y(z)}
            y2={y(z)}
          />
          <text className="profile__label" x={MARGIN.left - 6} y={y(z) + 3} textAnchor="end">
            {nf(z, stepZ < 1 ? 1 : 0)}
          </text>
        </g>
      ))}
      {marks.map((c) => (
        <g key={c}>
          <line
            className="profile__grid"
            x1={x(c)}
            x2={x(c)}
            y1={MARGIN.top}
            y2={HEIGHT - MARGIN.bottom}
          />
          <text
            className="profile__label"
            x={x(c)}
            y={HEIGHT - MARGIN.bottom + 14}
            textAnchor="middle"
          >
            {nf(c, 0)} m
          </text>
        </g>
      ))}
      {natural && (
        <path
          className="profile__ground profile__ground--natural"
          data-testid="terrain-profile-natural"
          d={naturalPath}
          clipPath="url(#terrain-profile-clip)"
        />
      )}
      <path
        className="profile__ground"
        data-testid="terrain-profile-ground"
        d={path}
        clipPath="url(#terrain-profile-clip)"
      />
      {probe && (
        <g pointerEvents="none">
          <line
            x1={x(probe.chainage)}
            x2={x(probe.chainage)}
            y1={MARGIN.top}
            y2={HEIGHT - MARGIN.bottom}
            stroke="var(--accent)"
            strokeWidth={1}
          />
          <text
            className="profile__label terrain-profile__probe"
            data-testid="terrain-profile-probe"
            x={Math.min(x(probe.chainage) + 6, WIDTH - 210)}
            y={MARGIN.top + 10}
          >
            {nf(probe.chainage, 1)} m ·{' '}
            {probe.elevation === null
              ? 'sem terreno'
              : `${natural ? 'TP' : 'cota'} ${nf(probe.elevation)} m · ${nf((probe.grade ?? 0) * 100, 1)} %`}
            {natural && probe.natural !== null ? ` · TN ${nf(probe.natural)} m` : ''}
          </text>
        </g>
      )}
    </svg>
  );
}

export function TerrainProfilePanel() {
  const project = useEditorStore((s) => s.project);
  const path = useTerrainStore((s) => s.profilePath);
  const [scale, setScale] = useState<Scale>('auto');
  // Perfil do terreno projetado (o natural, sem platôs) e, havendo platôs, também o natural.
  const design = useMemo(() => designTerrainOf(project), [project]);
  const twoGrounds = useMemo(() => hasDesignTerrain(project), [project]);
  const natural = project.terrain;
  const result = useMemo(
    () => (design && path ? terrainProfile(design, path) : null),
    [design, path],
  );
  const naturalProfile = useMemo(() => {
    if (!twoGrounds || !natural || !path) return null;
    const computed = terrainProfile(natural, path);
    return computed.ok ? computed.value : null;
  }, [twoGrounds, natural, path]);
  if (!path) return null;
  const close = (): void => useTerrainStore.getState().clearProfile();
  if (!result?.ok) {
    return (
      <div className="terrain-profile" data-testid="terrain-profile" data-state="empty">
        <span className="terrain__error" data-testid="terrain-profile-error">
          {result ? result.error.message : 'Não há superfície de terreno no projeto.'}
        </span>
        <button
          type="button"
          className="btn btn--icon"
          onClick={close}
          aria-label="Fechar o perfil"
        >
          <X size={14} />
        </button>
      </div>
    );
  }
  const profile = result.value;
  const partial = profile.coveredLength < profile.length - 1e-6;
  return (
    <div className="terrain-profile" data-testid="terrain-profile" data-state="ready">
      <div className="terrain-profile__bar">
        <strong>Perfil do terreno A–B</strong>
        {naturalProfile && (
          <span className="terrain-profile__legend" data-testid="terrain-profile-legend">
            <span className="legend__item legend__item--ground">projetado (TP)</span>
            <span className="legend__item legend__item--ground-natural">natural (TN)</span>
          </span>
        )}
        <span data-testid="terrain-profile-length">
          Extensão {formatMeters(profile.length, 2)} (em planta)
        </span>
        <span data-testid="terrain-profile-range">
          Cotas {nf(profile.minElevation ?? 0)} a {nf(profile.maxElevation ?? 0)} m
        </span>
        <span data-testid="terrain-profile-surface">
          Sobre o terreno {formatMeters(profile.surfaceLength, 2)}
        </span>
        {partial && (
          <span className="terrain__warning" data-testid="terrain-profile-partial">
            {formatMeters(profile.length - profile.coveredLength, 2)} do corte fora da superfície
            (sem cota)
          </span>
        )}
        <span className="terrain-profile__spacer" />
        <label
          className="plan__field"
          title="Exagero vertical do gráfico. 1:1 mostra o terreno em escala real."
        >
          <span>Escala V:H</span>
          <select
            data-testid="terrain-profile-scale"
            value={String(scale)}
            onChange={(event) =>
              setScale(
                event.target.value === 'auto' ? 'auto' : (Number(event.target.value) as Scale),
              )
            }
          >
            {SCALES.map((value) => (
              <option key={value} value={String(value)}>
                {value === 'auto'
                  ? 'Ajustar ao gráfico'
                  : value === 1
                    ? '1:1 (escala real)'
                    : `${value}:1`}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="btn btn--compact"
          data-testid="terrain-profile-csv"
          title="Baixar as estacas do perfil em CSV (distância, X, Y e cota)"
          onClick={() =>
            downloadText(
              `${projectFileBase(useEditorStore.getState().project)}-perfil-terreno.csv`,
              profileCsv(profile, naturalProfile),
              'text/csv',
            )
          }
        >
          <Download size={14} /> CSV
        </button>
        <button
          type="button"
          className="btn btn--icon"
          data-testid="terrain-profile-close"
          onClick={close}
          aria-label="Fechar o perfil"
        >
          <X size={14} />
        </button>
      </div>
      <Chart profile={profile} natural={naturalProfile} scale={scale} />
      <span className="muted terrain-profile__note" data-testid="terrain-profile-note">
        {profile.stations.filter((s) => s.elevation !== null).length} estacas (arestas da
        triangulação atravessadas).{' '}
        {scale === 1
          ? 'Escala real 1:1, sem exagero vertical.'
          : `Exagero vertical de ${nf(verticalFactor(profile, scale, naturalProfile), 1)}× só no gráfico: as declividades parecem maiores do que são.`}
      </span>
    </div>
  );
}
