import {
  degToRad,
  formatMeters,
  jointDeflectionLimit,
  radToDeg,
  resolvePort,
  vec3,
  type Result,
  type Vec3,
} from '@hydrobim/core';
import { useEffect, useMemo, useState } from 'react';
import { previewOf } from '../editor/operationPreview';
import { formatSegment } from '../editor/segment';
import {
  deflectionTo,
  resolveSegmentEntry,
  riserTargets,
  type SegmentEntry as Entry,
} from '../editor/segmentEntry';
import { elbowAnglesOf, useEditorStore } from '../state/editorStore';
import { planPipeSegment } from '../state/pipePreview';
import { parseDecimal } from './fields';

type FieldKey = 'length' | 'horizontal' | 'dx' | 'dy' | 'dz' | 'finalZ' | 'slope';

const FIELDS: { key: FieldKey; label: string; unit: string; title: string }[] = [
  { key: 'length', label: 'Comprimento', unit: 'm', title: 'Comprimento real do trecho' },
  {
    key: 'horizontal',
    label: 'Projeção',
    unit: 'm',
    title: 'Projeção horizontal (o que a planta mostra)',
  },
  { key: 'dx', label: 'ΔX', unit: 'm', title: 'Deslocamento em X a partir do ponto de partida' },
  { key: 'dy', label: 'ΔY', unit: 'm', title: 'Deslocamento em Y a partir do ponto de partida' },
  { key: 'dz', label: 'ΔZ', unit: 'm', title: 'Desnível: positivo sobe' },
  { key: 'finalZ', label: 'Cota final', unit: 'm', title: 'Cota Z do ponto final' },
  {
    key: 'slope',
    label: 'Declividade',
    unit: '%',
    title: 'Desnível por projeção horizontal; positiva sobe',
  },
];

const EMPTY: Record<FieldKey, string> = {
  length: '',
  horizontal: '',
  dx: '',
  dy: '',
  dz: '',
  finalZ: '',
  slope: '',
};

/** Valores digitados convertidos para SI; campo vazio = não informado. */
function toEntry(text: Record<FieldKey, string>, deflection: string): Entry {
  const read = (key: FieldKey): number | undefined =>
    text[key].trim() === '' ? undefined : parseDecimal(text[key]);
  const slope = read('slope');
  return {
    length: read('length'),
    horizontal: read('horizontal'),
    dx: read('dx'),
    dy: read('dy'),
    dz: read('dz'),
    finalZ: read('finalZ'),
    ...(slope === undefined ? {} : { slope: slope / 100 }),
    ...(deflection === 'cursor' ? {} : { deflection: degToRad(Number(deflection)) }),
  };
}

/**
 * Entrada dinâmica do trecho em andamento: comprimento, ângulo, deslocamentos, cota final e
 * declividade, com a prévia da montagem (peças que serão criadas ou a recusa do núcleo) antes
 * da confirmação. Enter confirma; os comandos de subir e descer criam a prumada até o
 * pavimento vizinho. O componente só resolve o ponto: a operação é a mesma do clique.
 */
export function SegmentEntry() {
  const anchor = useEditorStore((s) => s.anchor);
  const project = useEditorStore((s) => s.project);
  const cursor = useEditorStore((s) => s.cursor?.point ?? null);
  const activeSpec = useEditorStore((s) => s.activeSpec);
  const toolOptions = useEditorStore((s) => s.toolOptions);
  const workPlaneZ = useEditorStore((s) => s.workPlaneZ);
  const pipeElevation = useEditorStore((s) => s.pipeElevation);
  const [text, setText] = useState(EMPTY);
  const [deflection, setDeflection] = useState('cursor');
  // Ao digitar, o cursor sai da vista: vale a última direção apontada para este trecho.
  const [pointed, setPointed] = useState<Vec3 | null>(null);

  useEffect(() => {
    if (cursor) setPointed(cursor);
  }, [cursor]);
  // Trecho novo: os valores e a direção do anterior não valem mais.
  const anchorKey = anchor ? `${anchor.point.x};${anchor.point.y};${anchor.point.z}` : '';
  useEffect(() => {
    setText(EMPTY);
    setDeflection('cursor');
    setPointed(null);
  }, [anchorKey]);

  const origin = anchor?.port ? resolvePort(project, anchor.port) : undefined;
  const angles = useMemo(
    () =>
      origin && toolOptions.lockElbowAngles
        ? elbowAnglesOf(project, origin.spec).map((a) => Math.round(radToDeg(a) * 100) / 100)
        : [90, 45, 22.5, 11.25],
    [origin, project, toolOptions.lockElbowAngles],
  );

  // Deflexão que a junta de partida admite sem peça (dado de catálogo da especificação).
  const jointLimit = origin ? jointDeflectionLimit(origin, { spec: origin.spec, end: null }) : 0;
  const jointDegrees = Math.round(radToDeg(jointLimit) * 100) / 100;

  if (!anchor) return null;

  const context = {
    anchor: anchor.point,
    // Saindo de uma conexão, o eixo da porta é obrigatório; de um tubo, é a referência do ângulo.
    axis: anchor.lockAxis ?? origin?.direction ?? null,
    cursor: anchor.lockAxis ? null : pointed,
  };
  const typed = Object.values(text).some((value) => value.trim() !== '');
  const state = { project, anchor, activeSpec, toolOptions };
  const target: Result<Vec3> | null = typed
    ? resolveSegmentEntry(context, toEntry(text, deflection))
    : null;
  const preview =
    target && target.ok ? previewOf(project, planPipeSegment(state, target.value)) : null;
  const error = target && !target.ok ? target.error.message : (preview?.error ?? null);

  const apply = (): void => {
    if (!target?.ok || preview?.error) return;
    useEditorStore.getState().commitPoint(target.value);
  };

  // Subir e descer: mesma altura do eixo acima do piso, no pavimento vizinho.
  const risers = riserTargets(project.levels, anchor.point.z, pipeElevation);
  const riserPreview = (z: number) =>
    previewOf(project, planPipeSegment(state, vec3(anchor.point.x, anchor.point.y, z)));
  const rise = (z: number, levelElevation: number): void => {
    const store = useEditorStore.getState();
    const before = store.project;
    const previousPlane = store.workPlaneZ;
    // O nível de trabalho passa a ser o de destino; a prumada é criada pela mudança de elevação.
    store.setWorkPlaneZ(levelElevation);
    store.setPipeElevation(z - levelElevation);
    // Prumada recusada: o nível de trabalho volta ao anterior.
    if (useEditorStore.getState().project === before) store.setWorkPlaneZ(previousPlane);
  };

  return (
    <div className="options__group" data-testid="segment-entry">
      <span className="options__caption">Trecho por valores</span>
      <div className="entry__grid">
        {FIELDS.map((field) => (
          <label key={field.key} className="entry__field" title={field.title}>
            <span>{field.label}</span>
            <input
              type="text"
              inputMode="decimal"
              data-testid={`segment-${field.key}`}
              value={text[field.key]}
              placeholder="—"
              onChange={(event) => setText({ ...text, [field.key]: event.target.value })}
              onKeyDown={(event) => {
                // As teclas são do campo: não trocam de ferramenta nem cancelam o trecho.
                event.stopPropagation();
                if (event.key === 'Enter') apply();
                if (event.key === 'Escape') {
                  // Esc limpa os valores digitados; com os campos vazios, vale como no
                  // restante do editor (encerra o trecho em andamento).
                  if (typed) setText(EMPTY);
                  else {
                    event.currentTarget.blur();
                    useEditorStore.getState().cancelInteraction();
                  }
                }
              }}
            />
            <em>{field.unit}</em>
          </label>
        ))}
        <label
          className="entry__field"
          title="Mudança de direção em relação à extremidade de partida"
        >
          <span>Ângulo</span>
          <select
            data-testid="segment-deflection"
            value={deflection}
            disabled={!origin || anchor.lockAxis !== null}
            onChange={(event) => setDeflection(event.target.value)}
          >
            <option value="cursor">pelo cursor</option>
            <option value="0">0° (reto)</option>
            {jointLimit > 0 && (
              <option value={String(jointDegrees)} data-testid="segment-deflection-joint">
                {String(jointDegrees).replace('.', ',')}° (máx. na junta, sem peça)
              </option>
            )}
            {angles.map((angle) => (
              <option key={angle} value={String(angle)}>
                {String(angle).replace('.', ',')}°
              </option>
            ))}
          </select>
        </label>
      </div>
      <span
        className={error ? 'muted entry__preview entry__preview--error' : 'muted entry__preview'}
        data-testid="segment-preview"
        data-level={error ? 'error' : target ? 'ok' : 'idle'}
      >
        {!typed &&
          (pointed
            ? `Direção: a última apontada com o cursor${
                origin
                  ? ` (${Math.round(radToDeg(deflectionTo(context, pointed) ?? 0))}° da extremidade)`
                  : ''
              }. Digite os valores e pressione Enter.`
            : 'Digite os valores e pressione Enter; a direção vem do cursor ou de ΔX e ΔY.')}
        {typed && error}
        {typed && !error && target?.ok && preview && (
          <>
            {formatSegment(anchor.point, target.value, deflectionTo(context, target.value))} · fim
            em Z {formatMeters(target.value.z, 2)}. {preview.summary}.
          </>
        )}
      </span>
      <button
        type="button"
        className="btn btn--primary"
        data-testid="segment-apply"
        disabled={!target?.ok || Boolean(preview?.error)}
        onClick={apply}
      >
        Criar trecho
      </button>

      {(risers.up || risers.down) && (
        <div className="entry__risers" data-testid="segment-risers">
          {(['up', 'down'] as const).map((way) => {
            const riser = risers[way];
            if (!riser) return null;
            const plan = riserPreview(riser.z);
            return (
              <button
                key={way}
                type="button"
                className="chip"
                data-testid={`segment-riser-${way}`}
                disabled={plan.error !== null}
                title={plan.error ?? `Prumada até Z ${formatMeters(riser.z, 2)}: ${plan.summary}`}
                onClick={() => rise(riser.z, riser.z - riser.elevation)}
              >
                {way === 'up' ? '↑ Subir' : '↓ Descer'} até {riser.levelName} (Z{' '}
                {formatMeters(riser.z, 2)})
              </button>
            );
          })}
          <span className="muted">
            Eixo a {formatMeters(pipeElevation, 2)} do piso em {formatMeters(workPlaneZ, 2)}; a
            prumada mantém essa altura no pavimento de destino.
          </span>
        </div>
      )}
    </div>
  );
}
