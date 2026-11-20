import { formatMeters, terrainProfile, type TerrainProfile } from '@hydrobim/core';
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

export function profileCsv(profile: TerrainProfile): string {
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

/** Exagero vertical efetivo do gráfico (o desenho escala por igual nas duas direções). */
export function verticalFactor(profile: TerrainProfile, scale: Scale): number {
  if (scale !== 'auto') return scale;
  const innerWidth = WIDTH - MARGIN.left - MARGIN.right;
  const innerHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const relief = Math.max((profile.maxElevation ?? 1) - (profile.minElevation ?? 0), 1e-6);
  return (innerHeight * 0.86) / (relief * (innerWidth / profile.length));
}

function Chart({ profile, scale }: { profile: TerrainProfile; scale: Scale }) {
  const [hover, setHover] = useState<number | null>(null);
  const innerWidth = WIDTH - MARGIN.left - MARGIN.right;
  const innerHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const minZ = profile.minElevation ?? 0;
  const maxZ = profile.maxElevation ?? 1;
  const relief = Math.max(maxZ - minZ, 1e-6);
  // Unidades do gráfico por metro, na horizontal; a vertical é a horizontal vezes o exagero.
  const perMeter = innerWidth / profile.length;
  const factor = verticalFactor(profile, scale);
  const shown = innerHeight / (perMeter * factor);
  // Com escala fixa o desnível pode não caber: a janela vertical é centrada no relevo.
  const z0 = (minZ + maxZ) / 2 - shown / 2;
  const x = (chainage: number): number => MARGIN.left + chainage * perMeter;
  const y = (z: number): number => MARGIN.top + innerHeight - (z - z0) * perMeter * factor;
  const clipped = !(scale === 'auto') && relief > shown;

  const path = useMemo(() => {
    let d = '';
    let pen = false;
    for (const station of profile.stations) {
      if (station.elevation === null) {
        pen = false;
        continue;
      }
      d += `${pen ? 'L' : 'M'}${x(station.chainage).toFixed(2)} ${y(station.elevation).toFixed(2)}`;
      pen = true;
    }
    return d;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, factor]);

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
    for (let i = 1; i < stations.length; i += 1) {
      const a = stations[i - 1];
      const b = stations[i];
      if (!a || !b || hover < a.chainage || hover > b.chainage) continue;
      if (a.elevation === null || b.elevation === null) return { chainage: hover, elevation: null };
      const span = b.chainage - a.chainage;
      const t = span > 0 ? (hover - a.chainage) / span : 0;
      return {
        chainage: hover,
        elevation: a.elevation + t * (b.elevation - a.elevation),
        grade: span > 0 ? (b.elevation - a.elevation) / span : 0,
      };
    }
    return null;
  }, [hover, profile]);

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
      <path className="profile__ground" d={path} clipPath="url(#terrain-profile-clip)" />
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
              : `cota ${nf(probe.elevation)} m · ${nf((probe.grade ?? 0) * 100, 1)} %`}
          </text>
        </g>
      )}
    </svg>
  );
}

export function TerrainProfilePanel() {
  const terrain = useEditorStore((s) => s.project.terrain);
  const path = useTerrainStore((s) => s.profilePath);
  const [scale, setScale] = useState<Scale>('auto');
  const result = useMemo(
    () => (terrain && path ? terrainProfile(terrain, path) : null),
    [terrain, path],
  );
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
              profileCsv(profile),
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
      <Chart profile={profile} scale={scale} />
      <span className="muted terrain-profile__note" data-testid="terrain-profile-note">
        {profile.stations.filter((s) => s.elevation !== null).length} estacas (arestas da
        triangulação atravessadas).{' '}
        {scale === 1
          ? 'Escala real 1:1, sem exagero vertical.'
          : `Exagero vertical de ${nf(verticalFactor(profile, scale), 1)}× só no gráfico: as declividades parecem maiores do que são.`}
      </span>
    </div>
  );
}
