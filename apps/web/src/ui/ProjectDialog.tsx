import { FLANGED_PIPE_FAMILIES } from '@hydrobim/catalog';
import {
  buildProfile,
  MAX_TERRAIN_POINTS,
  computeQuantities,
  degToRad,
  detectClashes,
  findProjectedCrs,
  formatMeters,
  formatMillimeters,
  georeferenceStatus,
  getElement,
  radToDeg,
  SUPPORTED_CRS_SUMMARY,
  SYSTEM_KINDS,
  type Georeference,
  type Profile,
  type SystemKind,
} from '@hydrobim/core';
import { FileUp, Plus, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  familiesOf,
  selectPrimaryId,
  useEditorStore,
  type ProjectDialogTab,
} from '../state/editorStore';
import { exportQuantitiesFile, importTerrainFile } from '../state/projectActions';
import { NumberField, ReadOnlyRow, Section, SelectField, TextField } from './fields';
import { SYSTEM_KIND_LABELS } from './labels';

const actions = () => useEditorStore.getState();

type Tab = ProjectDialogTab;
/** Configuração do projeto (aba Gerenciar) e resultados (aba Análise) não se misturam. */
type Group = 'manage' | 'analysis';
const TABS: { id: Tab; label: string; group: Group }[] = [
  { id: 'levels', label: 'Níveis', group: 'manage' },
  { id: 'systems', label: 'Sistemas', group: 'manage' },
  { id: 'georeference', label: 'Georreferência', group: 'manage' },
  { id: 'terrain', label: 'Terreno', group: 'manage' },
  { id: 'clashes', label: 'Interferências', group: 'analysis' },
  { id: 'quantities', label: 'Quantitativo', group: 'analysis' },
  { id: 'profile', label: 'Perfil longitudinal', group: 'analysis' },
];
const GROUP_TITLES: Record<Group, string> = {
  manage: 'Gerenciar projeto',
  analysis: 'Análises do modelo',
};
const groupOf = (tab: Tab): Group => TABS.find((item) => item.id === tab)?.group ?? 'manage';

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
  verticalDatum: null,
  crsName: '',
  epsg: null,
  eastings: 0,
  northings: 0,
  orthogonalHeight: 0,
  rotation: 0,
};

function GeoreferenceTab({ onClose }: { onClose: () => void }) {
  const current = useEditorStore((s) => s.project.georeference);
  const infra = useEditorStore((s) => s.project.discipline === 'infra');
  const [draft, setDraft] = useState<Georeference>(current ?? EMPTY_GEO);
  useEffect(() => setDraft(current ?? EMPTY_GEO), [current]);
  // O estado é o do rascunho: o usuário vê a validação antes de gravar.
  const status = useMemo(() => georeferenceStatus(draft), [draft]);
  const saved = useMemo(() => georeferenceStatus(current), [current]);
  const origin =
    status.state === 'ready' ? status.transform.localToGeographic({ x: 0, y: 0 }) : null;
  const factors = status.state === 'ready' ? status.transform.factorsAt({ x: 0, y: 0 }) : null;
  return (
    <Section title="Georreferência" testId="tab-georeference">
      <span className="muted">
        Posição da origem local (0; 0; 0) do modelo no sistema de coordenadas projetado. Nada é
        preenchido automaticamente: informe o sistema de referência e as coordenadas do seu
        levantamento. Exportada no IFC como IfcProjectedCRS + IfcMapConversion. Os comprimentos e as
        cotas do projeto são sempre medidos nas coordenadas locais do modelo.
      </span>
      <NumberField
        label="Código EPSG"
        digits={0}
        value={draft.epsg ?? 0}
        title={`Código do sistema projetado. Sistemas que posicionam o mapa: ${SUPPORTED_CRS_SUMMARY}. Outros códigos valem para o IFC, sem mapa. Deixe 0 para informar só o nome.`}
        onCommit={(v) => {
          const epsg = v > 0 ? Math.round(v) : null;
          const known = epsg === null ? null : findProjectedCrs(epsg);
          // O nome oficial vem do código digitado; sem código reconhecido, vale o que o
          // usuário escrever.
          setDraft({ ...draft, epsg, crsName: known ? known.name : draft.crsName });
        }}
        testId="geo-epsg"
      />
      <TextField
        label="Sistema de referência"
        value={draft.crsName}
        onCommit={(crsName) => setDraft({ ...draft, crsName })}
        testId="geo-crs"
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
        label="Rotação do eixo X"
        unit="°"
        digits={4}
        value={radToDeg(draft.rotation)}
        title="Ângulo do eixo X local em relação ao leste da quadrícula, sentido anti-horário"
        onCommit={(v) => setDraft({ ...draft, rotation: degToRad(v) })}
        testId="geo-rotation"
      />
      <NumberField
        label="Altitude da origem"
        unit="m"
        value={draft.orthogonalHeight}
        title="Altitude, na referência altimétrica abaixo, do ponto de cota local Z = 0"
        onCommit={(orthogonalHeight) => setDraft({ ...draft, orthogonalHeight })}
        testId="geo-h"
      />
      <TextField
        label="Referência altimétrica"
        value={draft.verticalDatum ?? ''}
        onCommit={(text) => setDraft({ ...draft, verticalDatum: text.trim() || null })}
        testId="geo-vertical"
      />
      <span className="muted">
        Referência altimétrica: o datum vertical das cotas (ex.: Imbituba, Santana, ou "local"). Em
        branco = não informada; as cotas valem apenas como cotas do projeto.
      </span>
      <ReadOnlyRow
        label="Validação"
        value={
          <span
            data-testid="geo-validation"
            data-state={status.state}
            className={status.state === 'ready' ? undefined : 'warn'}
          >
            {draft.crsName.trim().length === 0
              ? 'Informe o sistema de referência.'
              : status.state === 'ready'
                ? `Transformação disponível: ${status.message}`
                : status.message}
          </span>
        }
      />
      {origin && factors && status.state === 'ready' && (
        <>
          <ReadOnlyRow
            label="Origem (latitude; longitude)"
            value={
              <span data-testid="geo-origin-geographic">
                {origin.lat.toFixed(6)}°; {origin.lon.toFixed(6)}° ({status.crs.datum})
              </span>
            }
          />
          <ReadOnlyRow
            label="Fator de escala da projeção"
            value={
              <span
                data-testid="geo-scale-factor"
                title="Distância na quadrícula ÷ distância no elipsoide, na origem. O modelo usa escala 1: em redes longas, a diferença entre a quadrícula e o terreno é a indicada"
              >
                {factors.scale.toFixed(6).replace('.', ',')} (
                {((factors.scale - 1) * 1000).toFixed(2).replace('.', ',')} m por km)
              </span>
            }
          />
          <ReadOnlyRow
            label="Convergência meridiana"
            value={
              <span data-testid="geo-convergence">
                {radToDeg(factors.convergence).toFixed(4).replace('.', ',')}°
              </span>
            }
          />
          <span className="muted">
            Confira a latitude e a longitude da origem com um ponto conhecido do levantamento.
            {status.crs.datumToMapAccuracy > 0 &&
              ` A passagem de ${status.crs.datum} para o WGS 84 do mapa é a transformação nula do banco EPSG (exatidão de ${status.crs.datumToMapAccuracy} m).`}
          </span>
        </>
      )}
      <div className="chips">
        <button
          type="button"
          className="btn btn--primary"
          data-testid="geo-save"
          onClick={() => actions().setGeoreference(draft)}
        >
          Definir georreferência
        </button>
        {infra && (
          <button
            type="button"
            className="btn"
            data-testid="geo-open-map"
            onClick={() => {
              actions().setGeoPicker(true);
              onClose();
            }}
            title="Abrir o mapa (satélite ou ruas) e clicar no ponto que será a origem do modelo"
          >
            Definir pelo mapa…
          </button>
        )}
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
          <span data-testid="geo-state" data-state={saved.state}>
            {current
              ? `Definida — ${current.crsName}${
                  saved.state === 'ready'
                    ? ''
                    : saved.state === 'invalid'
                      ? ' (origem fora do fuso: sem mapa)'
                      : ' (sem transformação para o mapa)'
                }`
              : 'Não definida'}
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
        são triangulados (TIN). Limite atual: {MAX_TERRAIN_POINTS.toLocaleString('pt-BR')} pontos.
        No ambiente Infra, a superfície também pode ser gerada dentro de uma área, a partir de DEM,
        GeoTIFF ou levantamento com linhas de quebra: Modelagem › Terreno › Superfície do terreno.
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
          <ReadOnlyRow
            label="Fonte"
            value={
              <span data-testid="terrain-source">
                {terrain.source.kind === 'dem' ? 'DEM' : 'Levantamento'} — {terrain.source.provider}
                {terrain.source.dataset ? ` (${terrain.source.dataset})` : ''}
              </span>
            }
          />
          <ReadOnlyRow
            label="Referência altimétrica"
            value={terrain.source.verticalDatum ?? 'não declarada pela fonte'}
          />
          <ReadOnlyRow
            label="Resolução do raster"
            value={
              terrain.source.resolution !== null
                ? formatMeters(terrain.source.resolution, 1)
                : 'não se aplica (pontos)'
            }
          />
          <ReadOnlyRow
            label="Exatidão altimétrica"
            value={
              terrain.source.verticalAccuracy !== null
                ? formatMeters(terrain.source.verticalAccuracy, 2)
                : 'não declarada pela fonte'
            }
          />
          <ReadOnlyRow
            label="Limite e linhas de quebra"
            value={`${terrain.boundary ? `${terrain.boundary.length} anel(is)` : 'envoltória dos pontos'} · ${terrain.breaklines.length} linha(s) de quebra`}
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

/** Lista de materiais em tela: as mesmas linhas da exportação em CSV. */
function QuantitiesTab() {
  const project = useEditorStore((s) => s.project);
  const rows = useMemo(
    () => computeQuantities(project, [...familiesOf(project), ...FLANGED_PIPE_FAMILIES]),
    [project],
  );
  const systems = new Map(project.systems.map((system) => [system.id, system.name]));
  return (
    <Section title="Quantitativo" testId="tab-quantities">
      <span className="muted">
        Tubos somados pelo comprimento entre portas; conexões, válvulas e equipamentos por unidade.
        Não inclui perdas de corte, juntas, parafusos nem acessórios de montagem.
      </span>
      {rows.length === 0 ? (
        <span className="muted" data-testid="quantities-empty">
          O projeto não tem elementos para quantificar.
        </span>
      ) : (
        <div className="quantities">
          <table data-testid="quantities-table">
            <thead>
              <tr>
                <th>Sistema</th>
                <th>Categoria</th>
                <th>Descrição</th>
                <th>Especificação</th>
                <th>Diâmetro</th>
                <th className="num">Quantidade</th>
                <th>Família</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={index} data-testid="quantities-row">
                  <td>{systems.get(row.system) ?? row.system}</td>
                  <td>{row.category}</td>
                  <td>{row.description}</td>
                  <td>{row.specification}</td>
                  <td>{row.size}</td>
                  <td className="num">
                    {row.unit === 'm' ? row.quantity.toFixed(2).replace('.', ',') : row.quantity}{' '}
                    {row.unit}
                  </td>
                  <td>{row.family}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="chips">
        <button
          type="button"
          className="btn"
          data-testid="quantities-export"
          disabled={rows.length === 0}
          onClick={exportQuantitiesFile}
        >
          Exportar em CSV
        </button>
      </div>
    </Section>
  );
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** Aba pedida por uma vista (ex.: georreferência, perfil); `nonce` distingue os pedidos. */
  request?: { tab: Tab; nonce: number } | null;
}

/**
 * Diálogo de configuração do projeto (níveis, sistemas, georreferência, terreno) ou de análises
 * (interferências, quantitativo, perfil), conforme a aba pedida: os dois grupos não se misturam.
 */
export function ProjectDialog({ open, onClose, request }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [tab, setTab] = useState<Tab>('levels');
  useEffect(() => {
    if (request) setTab(request.tab);
  }, [request]);

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
        <h2 data-testid="project-dialog-title">{GROUP_TITLES[groupOf(tab)]}</h2>
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
        {TABS.filter((item) => item.group === groupOf(tab)).map((item) => (
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
        {open && tab === 'georeference' && <GeoreferenceTab onClose={onClose} />}
        {open && tab === 'terrain' && <TerrainTab />}
        {open && tab === 'profile' && <ProfileTab />}
        {open && tab === 'clashes' && <ClashesTab />}
        {open && tab === 'quantities' && <QuantitiesTab />}
      </div>
    </dialog>
  );
}
