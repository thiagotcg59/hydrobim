import {
  buildProfile,
  degToRad,
  detectClashes,
  formatMeters,
  formatMillimeters,
  getElement,
  radToDeg,
  SYSTEM_KINDS,
  type Georeference,
  type Profile,
  type SystemKind,
} from '@hydrobim/core';
import { FileUp, Plus, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { selectPrimaryId, useEditorStore } from '../state/editorStore';
import { importTerrainFile } from '../state/projectActions';
import { NumberField, ReadOnlyRow, Section, SelectField, TextField } from './fields';
import { SYSTEM_KIND_LABELS } from './labels';

const actions = () => useEditorStore.getState();

type Tab = 'levels' | 'systems' | 'georeference' | 'terrain' | 'profile' | 'clashes';
const TABS: { id: Tab; label: string }[] = [
  { id: 'levels', label: 'Níveis' },
  { id: 'systems', label: 'Sistemas' },
  { id: 'georeference', label: 'Georreferência' },
  { id: 'terrain', label: 'Terreno' },
  { id: 'profile', label: 'Perfil' },
  { id: 'clashes', label: 'Interferências' },
];

function LevelsTab() {
  const levels = useEditorStore((s) => s.project.levels);
  const [name, setName] = useState('');
  const [elevation, setElevation] = useState(3);
  return (
    <Section title="Níveis e pavimentos" testId="tab-levels">
      <span className="muted">
        Os níveis definem os planos de trabalho e, na exportação IFC do ambiente MEP, os pavimentos
        (IfcBuildingStorey) em que cada elemento é contido.
      </span>
      <ul className="rows">
        {levels.map((level) => (
          <li key={level.id} className="rows__item" data-testid="level-row">
            <TextField
              label="Nome"
              value={level.name}
              onCommit={(value) => actions().updateLevel(level.id, { name: value })}
            />
            <NumberField
              label="Cota"
              unit="m"
              value={level.elevation}
              onCommit={(value) => actions().updateLevel(level.id, { elevation: value })}
            />
            <div className="chips">
              <button
                type="button"
                className="chip"
                onClick={() => actions().setWorkPlaneZ(level.elevation)}
              >
                Usar como plano de trabalho
              </button>
              <button
                type="button"
                className="chip"
                aria-label={`Excluir ${level.name}`}
                onClick={() => actions().removeLevel(level.id)}
              >
                <Trash2 size={13} /> Excluir
              </button>
            </div>
          </li>
        ))}
      </ul>
      <div className="rows__item">
        <TextField label="Novo nível" value={name} onCommit={setName} testId="level-name" />
        <NumberField
          label="Cota"
          unit="m"
          value={elevation}
          onCommit={setElevation}
          testId="level-elevation"
        />
        <button
          type="button"
          className="btn"
          data-testid="level-add"
          onClick={() => {
            actions().addLevel(name || `Nível ${levels.length + 1}`, elevation);
            setName('');
          }}
        >
          <Plus size={15} /> Adicionar nível
        </button>
      </div>
    </Section>
  );
}

function SystemsTab() {
  const project = useEditorStore((s) => s.project);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<SystemKind>('waterSupply');
  return (
    <Section title="Sistemas hidráulicos" testId="tab-systems">
      <ul className="rows">
        {project.systems.map((system) => {
          const count = project.elements.filter((e) => e.systemId === system.id).length;
          return (
            <li key={system.id} className="rows__item" data-testid="system-row">
              <TextField
                label="Nome"
                value={system.name}
                onCommit={(value) => actions().updateSystem(system.id, { name: value })}
              />
              <SelectField
                label="Tipo"
                value={system.kind}
                options={SYSTEM_KINDS.map((k) => ({ value: k, label: SYSTEM_KIND_LABELS[k] }))}
                onChange={(value) => actions().updateSystem(system.id, { kind: value })}
              />
              <div className="chips">
                <label className="check" title="Cor de exibição dos elementos do sistema">
                  <input
                    type="color"
                    value={system.color ?? '#3ea6ff'}
                    onChange={(event) =>
                      actions().updateSystem(system.id, { color: event.target.value })
                    }
                  />
                  Cor
                </label>
                {system.color && (
                  <button
                    type="button"
                    className="chip"
                    onClick={() => actions().updateSystem(system.id, { color: undefined })}
                  >
                    Usar cor do material
                  </button>
                )}
                <label className="check">
                  <input
                    type="checkbox"
                    checked={system.visible !== false}
                    onChange={(event) =>
                      actions().updateSystem(system.id, { visible: event.target.checked })
                    }
                  />
                  Visível
                </label>
                <span className="muted">{count} elemento(s)</span>
                <button
                  type="button"
                  className="chip"
                  onClick={() =>
                    actions().selectMany(
                      project.elements.filter((e) => e.systemId === system.id).map((e) => e.id),
                    )
                  }
                >
                  Selecionar
                </button>
                <button
                  type="button"
                  className="chip"
                  aria-label={`Excluir ${system.name}`}
                  onClick={() => actions().removeSystem(system.id)}
                >
                  <Trash2 size={13} /> Excluir
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      <div className="rows__item">
        <TextField label="Novo sistema" value={name} onCommit={setName} testId="system-name" />
        <SelectField
          label="Tipo"
          value={kind}
          options={SYSTEM_KINDS.map((k) => ({ value: k, label: SYSTEM_KIND_LABELS[k] }))}
          onChange={setKind}
        />
        <button
          type="button"
          className="btn"
          data-testid="system-add"
          onClick={() => {
            actions().addSystem(name || `Sistema ${project.systems.length + 1}`, kind);
            setName('');
          }}
        >
          <Plus size={15} /> Adicionar sistema
        </button>
      </div>
      <span className="muted">
        Para mover elementos entre sistemas, selecione-os e altere o campo "Sistema" no painel de
        propriedades.
      </span>
    </Section>
  );
}

const EMPTY_GEO: Georeference = {
  crsName: '',
  epsg: null,
  eastings: 0,
  northings: 0,
  orthogonalHeight: 0,
  rotation: 0,
};

function GeoreferenceTab() {
  const current = useEditorStore((s) => s.project.georeference);
  const [draft, setDraft] = useState<Georeference>(current ?? EMPTY_GEO);
  useEffect(() => setDraft(current ?? EMPTY_GEO), [current]);
  return (
    <Section title="Georreferência" testId="tab-georeference">
      <span className="muted">
        Posição da origem local (0; 0; 0) do modelo no sistema de coordenadas projetado. Nada é
        preenchido automaticamente: informe o sistema de referência e as coordenadas do seu
        levantamento. Exportada no IFC como IfcProjectedCRS + IfcMapConversion.
      </span>
      <TextField
        label="Sistema de referência"
        value={draft.crsName}
        onCommit={(crsName) => setDraft({ ...draft, crsName })}
        testId="geo-crs"
      />
      <NumberField
        label="Código EPSG (opcional)"
        digits={0}
        value={draft.epsg ?? 0}
        onCommit={(v) => setDraft({ ...draft, epsg: v > 0 ? Math.round(v) : null })}
        testId="geo-epsg"
      />
      <NumberField
        label="Este (E)"
        unit="m"
        value={draft.eastings}
        onCommit={(eastings) => setDraft({ ...draft, eastings })}
        testId="geo-e"
      />
      <NumberField
        label="Norte (N)"
        unit="m"
        value={draft.northings}
        onCommit={(northings) => setDraft({ ...draft, northings })}
        testId="geo-n"
      />
      <NumberField
        label="Altitude da origem"
        unit="m"
        value={draft.orthogonalHeight}
        onCommit={(orthogonalHeight) => setDraft({ ...draft, orthogonalHeight })}
        testId="geo-h"
      />
      <NumberField
        label="Rotação do eixo X"
        unit="°"
        digits={4}
        value={radToDeg(draft.rotation)}
        title="Ângulo do eixo X local em relação ao leste, sentido anti-horário"
        onCommit={(v) => setDraft({ ...draft, rotation: degToRad(v) })}
        testId="geo-rotation"
      />
      <div className="chips">
        <button
          type="button"
          className="btn btn--primary"
          data-testid="geo-save"
          onClick={() => actions().setGeoreference(draft)}
        >
          Definir georreferência
        </button>
        {current && (
          <button
            type="button"
            className="btn"
            data-testid="geo-clear"
            onClick={() => actions().setGeoreference(null)}
          >
            Remover
          </button>
        )}
      </div>
      <ReadOnlyRow
        label="Estado"
        value={
          <span data-testid="geo-state">
            {current ? `Definida — ${current.crsName}` : 'Não definida'}
          </span>
        }
      />
    </Section>
  );
}

function TerrainTab() {
  const terrain = useEditorStore((s) => s.project.terrain);
  const fileRef = useRef<HTMLInputElement>(null);
  const range = useMemo(() => {
    if (!terrain) return null;
    let min = Infinity;
    let max = -Infinity;
    for (const p of terrain.points) {
      min = Math.min(min, p.z);
      max = Math.max(max, p.z);
    }
    return { min, max };
  }, [terrain]);
  return (
    <Section title="Terreno" testId="tab-terrain">
      <span className="muted">
        Importe um arquivo de texto com um ponto por linha — "X Y Z" em metros, nas coordenadas
        locais do modelo (separados por espaço, vírgula, tabulação ou ponto e vírgula). Os pontos
        são triangulados (TIN). Limite atual: 4.000 pontos.
      </span>
      <input
        ref={fileRef}
        type="file"
        accept=".txt,.csv,.xyz,text/plain,text/csv"
        hidden
        data-testid="terrain-file"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) await importTerrainFile(file);
        }}
      />
      <div className="chips">
        <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
          <FileUp size={15} /> Importar pontos XYZ…
        </button>
        {terrain && (
          <button
            type="button"
            className="btn"
            data-testid="terrain-remove"
            onClick={() => actions().setTerrain(null)}
          >
            <Trash2 size={15} /> Remover terreno
          </button>
        )}
      </div>
      {terrain && range ? (
        <>
          <ReadOnlyRow label="Nome" value={terrain.name} />
          <ReadOnlyRow
            label="Pontos"
            value={<span data-testid="terrain-points">{terrain.points.length}</span>}
          />
          <ReadOnlyRow label="Triângulos" value={terrain.triangles.length / 3} />
          <ReadOnlyRow
            label="Cotas"
            value={`${formatMeters(range.min, 2)} a ${formatMeters(range.max, 2)}`}
          />
        </>
      ) : (
        <span className="muted" data-testid="terrain-empty">
          Nenhum terreno importado.
        </span>
      )}
    </Section>
  );
}

/** Desenho do perfil longitudinal (SVG): terreno, geratriz superior e eixo. */
function ProfileChart({ profile }: { profile: Profile }) {
  const width = 760;
  const height = 300;
  const margin = { left: 56, right: 16, top: 16, bottom: 34 };
  const { stations } = profile;
  let min = Infinity;
  let max = -Infinity;
  for (const s of stations) {
    min = Math.min(min, s.axisElevation - (s.crownElevation - s.axisElevation));
    max = Math.max(max, s.crownElevation, s.groundElevation ?? -Infinity);
  }
  const pad = Math.max((max - min) * 0.15, 0.5);
  min -= pad;
  max += pad;
  const x = (chainage: number): number =>
    margin.left +
    (chainage / Math.max(profile.length, 1e-9)) * (width - margin.left - margin.right);
  const y = (z: number): number =>
    margin.top + (1 - (z - min) / (max - min)) * (height - margin.top - margin.bottom);
  const path = (pick: (s: (typeof stations)[number]) => number | null): string => {
    let d = '';
    let pen = false;
    for (const s of stations) {
      const z = pick(s);
      if (z === null) {
        pen = false;
        continue;
      }
      d += `${pen ? 'L' : 'M'}${x(s.chainage).toFixed(1)},${y(z).toFixed(1)} `;
      pen = true;
    }
    return d;
  };
  const ticks = 5;
  return (
    <svg
      className="profile"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Perfil longitudinal"
      data-testid="profile-chart"
    >
      {Array.from({ length: ticks + 1 }, (_, i) => {
        const z = min + ((max - min) * i) / ticks;
        return (
          <g key={`z${i}`}>
            <line
              x1={margin.left}
              x2={width - margin.right}
              y1={y(z)}
              y2={y(z)}
              className="profile__grid"
            />
            <text x={margin.left - 6} y={y(z) + 4} textAnchor="end" className="profile__label">
              {z.toFixed(2).replace('.', ',')}
            </text>
          </g>
        );
      })}
      {Array.from({ length: ticks + 1 }, (_, i) => {
        const c = (profile.length * i) / ticks;
        return (
          <text
            key={`c${i}`}
            x={x(c)}
            y={height - 12}
            textAnchor="middle"
            className="profile__label"
          >
            {c.toFixed(1).replace('.', ',')} m
          </text>
        );
      })}
      <path d={path((s) => s.groundElevation)} className="profile__ground" />
      <path d={path((s) => s.crownElevation)} className="profile__crown" />
      <path d={path((s) => s.axisElevation)} className="profile__axis" />
    </svg>
  );
}

function ProfileTab() {
  const project = useEditorStore((s) => s.project);
  const primaryId = useEditorStore(selectPrimaryId);
  const element = primaryId ? getElement(project, primaryId) : undefined;
  const result = useMemo(
    () => (element ? buildProfile(project, element.id) : null),
    [project, element],
  );
  if (!element || !result) {
    return (
      <Section title="Perfil longitudinal" testId="tab-profile">
        <span className="muted">
          Selecione um tubo ou conexão do trecho antes de abrir esta aba. O perfil segue a rede nos
          dois sentidos, pela passagem dos tês, até extremidades livres ou equipamentos.
        </span>
      </Section>
    );
  }
  if (!result.ok) {
    return (
      <Section title="Perfil longitudinal" testId="tab-profile">
        <span className="warn">{result.error.message}</span>
      </Section>
    );
  }
  const profile = result.value;
  const covers = profile.stations.map((s) => s.cover).filter((c): c is number => c !== null);
  const minCover = covers.length ? Math.min(...covers) : null;
  return (
    <Section title={`Perfil longitudinal — a partir de "${element.name}"`} testId="tab-profile">
      <ProfileChart profile={profile} />
      <div className="legend">
        <span className="legend__item legend__item--ground">Terreno</span>
        <span className="legend__item legend__item--crown">Geratriz superior</span>
        <span className="legend__item legend__item--axis">Eixo</span>
      </div>
      <ReadOnlyRow
        label="Extensão em planta"
        value={<span data-testid="profile-length">{formatMeters(profile.length, 2)}</span>}
      />
      <ReadOnlyRow label="Elementos no caminho" value={profile.elementIds.length} />
      <ReadOnlyRow
        label="Recobrimento mínimo"
        value={
          <span
            data-testid="profile-cover"
            className={minCover !== null && minCover < 0 ? 'warn' : undefined}
          >
            {minCover === null ? 'Sem terreno sob o traçado' : formatMeters(minCover, 2)}
          </span>
        }
      />
      <div className="chips">
        <button
          type="button"
          className="chip"
          onClick={() => actions().selectMany(profile.elementIds)}
        >
          Selecionar elementos do caminho
        </button>
      </div>
      <span className="muted">
        Distâncias medidas em planta; cotas no eixo vertical (escalas diferentes).
      </span>
    </Section>
  );
}

function ClashesTab() {
  const project = useEditorStore((s) => s.project);
  const clashes = useMemo(() => detectClashes(project), [project]);
  return (
    <Section title="Interferências entre tubos" testId="tab-clashes">
      <span className="muted">
        Verifica tubos cujas paredes externas se interpenetram, ignorando tubos unidos por uma mesma
        conexão. Conexões, válvulas e equipamentos ainda não são analisados.
      </span>
      <ReadOnlyRow
        label="Interferências"
        value={<span data-testid="clash-count">{clashes.length}</span>}
      />
      <ul className="rows">
        {clashes.map((clash, index) => {
          const [a, b] = clash.elementIds.map((id) => getElement(project, id));
          return (
            <li key={index} className="rows__item">
              <button
                type="button"
                className="link"
                data-testid="clash-item"
                onClick={() => actions().selectMany([...clash.elementIds])}
              >
                {a?.name ?? '?'} × {b?.name ?? '?'}
              </button>
              <span className="muted">
                sobreposição de {formatMillimeters(clash.overlap)} em{' '}
                {formatMeters(clash.point.x, 2)}; {formatMeters(clash.point.y, 2)};{' '}
                {formatMeters(clash.point.z, 2)}
              </span>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

interface Props {
  open: boolean;
  onClose: () => void;
}

/** Dados de projeto e análises: níveis, sistemas, georreferência, terreno, perfil e interferências. */
export function ProjectDialog({ open, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [tab, setTab] = useState<Tab>('levels');

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      className="dialog dialog--wide"
      data-testid="project-dialog"
      onClose={onClose}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <header className="dialog__header">
        <h2>Projeto e análises</h2>
        <button
          type="button"
          className="btn btn--icon"
          onClick={onClose}
          aria-label="Fechar"
          data-testid="project-close"
        >
          <X size={16} />
        </button>
      </header>
      <nav className="tabs" role="tablist">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            data-testid={`tab-button-${item.id}`}
            className={tab === item.id ? 'tabs__item is-active' : 'tabs__item'}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>
      <div className="dialog__body dialog__body--tall">
        {open && tab === 'levels' && <LevelsTab />}
        {open && tab === 'systems' && <SystemsTab />}
        {open && tab === 'georeference' && <GeoreferenceTab />}
        {open && tab === 'terrain' && <TerrainTab />}
        {open && tab === 'profile' && <ProfileTab />}
        {open && tab === 'clashes' && <ClashesTab />}
      </div>
    </dialog>
  );
}
