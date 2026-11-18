import {
  FLANGE_FAMILIES,
  FLANGED_PIPE_FAMILIES,
  flangeEnd,
  getSpecification,
  PIPE_END_CONFIGURATION_LABELS,
  PIPE_END_CONFIGURATIONS,
  resolvePipeEnds,
  resolvePipeSpec,
  type FlangedPipeFamily,
  type FlangeFamily,
  type FlangeSize,
  type PipeEndConfiguration,
} from '@hydrobim/catalog';
import { addPipe, getElement, vec3, type Pipe } from '@hydrobim/core';
import { looseFlange, type MeshPart } from '@hydrobim/geometry';
import { PackagePlus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useEditorStore } from '../state/editorStore';
import { FamilyPreview } from '../viewport/FamilyPreview';
import { formatDecimal, NumberField, SelectField } from './fields';

interface Props {
  /** O canvas 3D só é montado com o diálogo aberto. */
  open: boolean;
  /** Fecha o catálogo depois de levar a família para a ferramenta Tubo. */
  onUse: () => void;
}

/** Tubo cujo diâmetro externo é adotado como furo do flange avulso (não tabulado). */
const BORE_SPECIFICATION = 'ferro-ductil-nbr7675-k9';

type Selected =
  { type: 'flange'; family: FlangeFamily } | { type: 'pipe'; family: FlangedPipeFamily } | null;

export type FlangeModel = { ok: true; parts: MeshPart[] } | { ok: false; reason: string };
type PipeModel = { ok: true; pipe: Pipe } | { ok: false; reason: string };

const mm = (value: number): string => formatDecimal(value, 1);

/** Modelo 3D do flange avulso de uma linha da tabela, ou o motivo de não haver modelo. */
export function flangeModel(family: FlangeFamily, size: FlangeSize): FlangeModel {
  const end = flangeEnd(family.pressureClass, size.dn);
  const pipe = resolvePipeSpec(BORE_SPECIFICATION, size.dn);
  if (!end) return { ok: false, reason: 'A tabela não traz este diâmetro.' };
  if (!pipe) {
    return {
      ok: false,
      reason: `O furo do flange não é tabulado e o catálogo embutido não tem tubo de ferro dúctil DN ${size.dn} de onde adotá-lo. Sem essa dimensão, o modelo não é gerado.`,
    };
  }
  return {
    ok: true,
    parts: looseFlange(end, pipe.outerDiameter / 2).map((mesh) => ({ role: 'body', mesh })),
  };
}

/**
 * Flanges do catálogo (tabela única usada por todas as peças flangeadas) e tubos de ferro
 * fundido dúctil com flanges. As tabelas são somente leitura; "Usar na ferramenta Tubo"
 * leva a família e a configuração de extremidades para o traçado.
 */
export function FlangeLibrary({ open, onUse }: Props) {
  const project = useEditorStore((s) => s.project);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [row, setRow] = useState(0);
  const [configuration, setConfiguration] = useState<PipeEndConfiguration>('flangeFlange');
  const [length, setLength] = useState(1);
  useEffect(() => {
    setRow(0);
  }, [selectedId]);

  const flange = FLANGE_FAMILIES.find((f) => f.id === selectedId);
  const pipeFamily = FLANGED_PIPE_FAMILIES.find((f) => f.id === selectedId);
  const selected: Selected = flange
    ? { type: 'flange', family: flange }
    : pipeFamily
      ? { type: 'pipe', family: pipeFamily }
      : null;

  const flangeTable =
    flange ?? FLANGE_FAMILIES.find((f) => f.pressureClass === pipeFamily?.pressureClass);
  const pipeSizes = pipeFamily ? (getSpecification(pipeFamily.specificationId)?.sizes ?? []) : [];
  // Tubos: só os diâmetros que existem na especificação do tubo E na tabela de flanges.
  const rows = (flangeTable?.sizes ?? []).filter(
    (size) => !pipeFamily || pipeSizes.some((p) => p.dn === size.dn),
  );
  const index = Math.min(row, Math.max(rows.length - 1, 0));
  const size = rows[index];

  const model = useMemo((): FlangeModel | PipeModel | null => {
    if (!size) return null;
    if (flange) return flangeModel(flange, size);
    if (!pipeFamily) return null;
    const spec = resolvePipeSpec(pipeFamily.specificationId, size.dn);
    const ends = spec ? resolvePipeEnds(spec, pipeFamily.id, configuration) : null;
    if (!spec || !ends) return { ok: false, reason: 'Diâmetro sem tubo ou sem flange tabulado.' };
    // A prévia usa a mesma operação da inserção; nada é gravado no projeto.
    const built = addPipe(project, {
      start: vec3(0, 0, 0),
      end: vec3(length, 0, 0),
      spec,
      ends: { ...ends, familyId: pipeFamily.id },
    });
    if (!built.ok) return { ok: false, reason: built.error.message };
    const pipe = getElement(built.value.project, built.value.elementId);
    return pipe?.kind === 'pipe'
      ? { ok: true, pipe }
      : { ok: false, reason: 'Falha ao gerar o modelo.' };
  }, [flange, pipeFamily, size, configuration, length, project]);

  const use = (): void => {
    if (!pipeFamily || !size) return;
    const store = useEditorStore.getState();
    store.setActiveSpec(pipeFamily.specificationId, size.dn);
    store.setToolOptions({ pipeEnds: { configuration, familyId: pipeFamily.id } });
    store.setTool('pipe');
    onUse();
  };

  const item = (id: string, name: string, detail: string) => (
    <li key={id}>
      <button
        type="button"
        data-testid="flange-family-item"
        data-family-id={id}
        className={id === selectedId ? 'element-list__item is-active' : 'element-list__item'}
        onClick={() => setSelectedId(id)}
      >
        <span>{name}</span>
        <span className="muted">{detail}</span>
      </button>
    </li>
  );

  return (
    <div className="families" data-testid="flange-library">
      <aside className="families__list">
        <span className="section__title">Flanges</span>
        <ul className="element-list" data-testid="flange-family-list">
          {FLANGE_FAMILIES.map((f) => item(f.id, f.name, `${f.sizes.length} diâmetros`))}
        </ul>
        <span className="section__title">Tubos com flanges</span>
        <ul className="element-list" data-testid="flanged-pipe-family-list">
          {FLANGED_PIPE_FAMILIES.map((f) => item(f.id, f.name, 'comprimento livre'))}
        </ul>
      </aside>

      <section className="families__detail">
        {!selected && (
          <p className="muted">
            Selecione uma classe de flange para consultar a tabela do catálogo e o modelo 3D, ou uma
            família de tubos com flanges para escolher as extremidades e o comprimento. Todas as
            peças flangeadas do catálogo (conexões, válvulas e tubos) usam estas tabelas.
          </p>
        )}
        {selected && flangeTable && (
          <>
            <div className="products__header">
              <h3>{selected.family.name}</h3>
              {selected.type === 'pipe' && (
                <button
                  type="button"
                  className="btn btn--primary"
                  data-testid="flange-library-use"
                  disabled={!model?.ok}
                  onClick={use}
                  title="Abre a ferramenta Tubo com esta família, este diâmetro e estas extremidades."
                >
                  <PackagePlus size={15} /> Usar na ferramenta Tubo
                </button>
              )}
            </div>
            <p className="muted families__source" data-testid="flange-library-source">
              {selected.family.manufacturer ?? 'Fabricante não identificado nas páginas recebidas'}{' '}
              · {selected.family.standard} · Fonte: {selected.family.source}
            </p>

            {selected.type === 'pipe' && (
              <div className="options__group" data-testid="flanged-pipe-options">
                <SelectField
                  label="Extremidades"
                  value={configuration}
                  options={PIPE_END_CONFIGURATIONS.map((value) => ({
                    value,
                    label: PIPE_END_CONFIGURATION_LABELS[value],
                  }))}
                  onChange={setConfiguration}
                  testId="flanged-pipe-configuration"
                />
                <NumberField
                  label="Comprimento da prévia"
                  unit="m"
                  digits={3}
                  value={length}
                  onCommit={(value) => setLength(Math.max(0.05, value))}
                  testId="flanged-pipe-length"
                />
              </div>
            )}

            <div className="families__body">
              <div className="products__info">
                <div className="families__table">
                  <table data-testid="flange-table">
                    <thead>
                      <tr>
                        <th>DN</th>
                        <th title="Diâmetro externo do flange">
                          D<small> mm</small>
                        </th>
                        <th title="Diâmetro do círculo de furação">
                          C<small> mm</small>
                        </th>
                        <th title="Diâmetro dos furos">
                          d<small> mm</small>
                        </th>
                        <th>Parafusos</th>
                        <th title="Espessura do flange (inclui o ressalto — leitura adotada)">
                          a<small> mm</small>
                        </th>
                        <th title="Diâmetro do ressalto">
                          g<small> mm</small>
                        </th>
                        <th title="Altura do ressalto">
                          c<small> mm</small>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((line, i) => (
                        <tr
                          key={line.dn}
                          data-testid="flange-row"
                          data-dn={line.dn}
                          className={i === index ? 'is-preview' : undefined}
                          onClick={() => setRow(i)}
                        >
                          <td>{line.dn}</td>
                          <td>{mm(line.D)}</td>
                          <td>{mm(line.C)}</td>
                          <td>{mm(line.d)}</td>
                          <td>
                            {line.boltCount} × {line.bolt}
                          </td>
                          <td>{mm(line.a)}</td>
                          <td>{mm(line.g)}</td>
                          <td>{mm(line.c)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="products__notes" data-testid="flange-library-approximations">
                  <span className="section__title">Não tabulado (derivado ou representação)</span>
                  <ul>
                    {[
                      ...selected.family.approximations,
                      ...(selected.type === 'pipe' ? flangeTable.approximations : []),
                    ].map((note) => (
                      <li key={note}>{note}</li>
                    ))}
                  </ul>
                </div>
                {flangeTable.remarks.length > 0 && (
                  <div className="products__notes" data-testid="flange-library-remarks">
                    <span className="section__title">Observações do catálogo</span>
                    <ul>
                      {flangeTable.remarks.map((note) => (
                        <li key={note}>{note}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              <figure
                className="families__preview"
                data-testid="flange-preview"
                data-dn={size?.dn}
                data-state={model?.ok ? 'model' : 'empty'}
              >
                <div className="families__preview-view">
                  {open && model?.ok && 'parts' in model && (
                    <FamilyPreview parts={model.parts} material="ductileIron" />
                  )}
                  {open && model?.ok && 'pipe' in model && <FamilyPreview element={model.pipe} />}
                  {model && !model.ok && (
                    <p className="muted" data-testid="flange-preview-message">
                      {model.reason}
                    </p>
                  )}
                </div>
                <figcaption className="muted">
                  {size && <strong>DN {size.dn}</strong>} Clique em uma linha para ver o modelo.
                  Arraste para girar; role para aproximar.
                </figcaption>
              </figure>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
