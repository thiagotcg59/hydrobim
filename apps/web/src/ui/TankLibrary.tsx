import { TANK_FAMILIES } from '@hydrobim/catalog';
import {
  buildFitting,
  tankGeometricVolume,
  tankLayout,
  tankParametersFromFamily,
  tankVariantLabel,
  type Tank,
  type TankFamily,
} from '@hydrobim/core';
import { PackagePlus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useEditorStore } from '../state/editorStore';
import { FamilyPreview } from '../viewport/FamilyPreview';
import { formatDecimal } from './fields';

interface Props {
  /** O canvas 3D só é montado com o diálogo aberto. */
  open: boolean;
  /** Fecha o catálogo depois de levar o modelo para a ferramenta Reservatório. */
  onUse: () => void;
}

type Model = { ok: true; tank: Tank } | { ok: false; reason: string };

const meters = (value: number): string =>
  value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 3 });

/**
 * Reservatórios do catálogo: tabelas dos fabricantes (somente leitura) e o modelo 3D gerado
 * pela mesma operação usada na inserção. Famílias sem tabela mostram o modelo com as
 * dimensões iniciais, identificadas como do usuário.
 */
export function TankLibrary({ open, onUse }: Props) {
  const project = useEditorStore((s) => s.project);
  const activeSpec = useEditorStore((s) => s.activeSpec);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [row, setRow] = useState(0);
  const family: TankFamily | null = TANK_FAMILIES.find((f) => f.id === selectedId) ?? null;
  useEffect(() => {
    setRow(0);
  }, [selectedId]);

  const index = family ? Math.min(row, Math.max(family.variants.length - 1, 0)) : -1;
  const variant = family?.variants[index];
  const model = useMemo((): Model | null => {
    if (!family) return null;
    const parameters = tankParametersFromFamily(
      family,
      variant ? { variantId: variant.id } : { custom: {} },
    );
    if (!parameters.ok) return { ok: false, reason: parameters.error.message };
    // A prévia usa a especificação ativa só para os bocais; nada é inserido no projeto.
    const built = buildFitting(
      project,
      { kind: 'tank', parameters: parameters.value },
      activeSpec,
      project.systems[0]?.id ?? 'previa',
    );
    if (!built.ok) return { ok: false, reason: built.error.message };
    return built.value.kind === 'tank'
      ? { ok: true, tank: built.value }
      : { ok: false, reason: 'Falha ao gerar o modelo.' };
  }, [project, activeSpec, family, variant]);

  const use = (): void => {
    if (!family) return;
    const store = useEditorStore.getState();
    store.setToolOptions({
      tank: { familyId: family.id, variantId: variant?.id ?? null, custom: {} },
    });
    store.setTool('tank');
    onUse();
  };

  return (
    <div className="families" data-testid="tank-library">
      <aside className="families__list">
        <span className="section__title">Reservatórios metálicos</span>
        <ul className="element-list" data-testid="tank-family-list">
          {TANK_FAMILIES.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                data-testid="tank-family-item"
                data-family-id={item.id}
                className={
                  item.id === selectedId ? 'element-list__item is-active' : 'element-list__item'
                }
                onClick={() => setSelectedId(item.id)}
              >
                <span>{item.name}</span>
                <span className="muted">
                  {item.manufacturer} ·{' '}
                  {item.variants.length > 0 ? `${item.variants.length} modelos` : 'sem tabela'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <section className="families__detail">
        {!family && (
          <p className="muted">
            Selecione uma família de reservatórios para consultar a tabela do fabricante e o modelo
            3D. As tabelas são somente leitura; dimensões personalizadas, acessórios e bocais são
            definidos na ferramenta Reservatório e no painel de propriedades.
          </p>
        )}
        {family && (
          <>
            <div className="products__header">
              <h3>{family.name}</h3>
              <button
                type="button"
                className="btn btn--primary"
                data-testid="tank-library-use"
                onClick={use}
                title="Abre a ferramenta Reservatório com esta família e este modelo selecionados."
              >
                <PackagePlus size={15} /> Inserir no modelo
              </button>
            </div>
            <p className="muted families__source">{family.description}</p>
            <p className="muted families__source" data-testid="tank-library-source">
              {family.manufacturer} · {family.material} · Fonte: {family.source}
            </p>

            <div className="families__body">
              <div className="products__info">
                {family.variants.length > 0 ? (
                  <div className="families__table">
                    <table data-testid="tank-table">
                      <thead>
                        <tr>
                          <th>
                            Capacidade<small> L</small>
                          </th>
                          <th>
                            Altura total<small> m</small>
                          </th>
                          <th>
                            {family.tankType === 'gobletWet' || family.tankType === 'gobletDry'
                              ? 'Ø da taça'
                              : 'Diâmetro'}
                            <small> m</small>
                          </th>
                          {family.variants.some((v) => v.columnHeight !== undefined) && (
                            <th>
                              Altura da coluna<small> m</small>
                            </th>
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {family.variants.map((item, i) => (
                          <tr
                            key={item.id}
                            data-testid="tank-row"
                            data-variant-id={item.id}
                            className={i === index ? 'is-preview' : undefined}
                            onClick={() => setRow(i)}
                            title={tankVariantLabel(item)}
                          >
                            <td>
                              {item.capacityL.toLocaleString('pt-BR')}
                              {item.mark ?? ''}
                            </td>
                            <td>{meters(item.height)}</td>
                            <td>{meters(item.diameter)}</td>
                            {item.columnHeight !== undefined && (
                              <td>{meters(item.columnHeight)}</td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="warn" data-testid="tank-library-no-table">
                    O catálogo não tabula os modelos desta família — informa só a faixa de{' '}
                    {family.capacityRangeL[0].toLocaleString('pt-BR')} a{' '}
                    {family.capacityRangeL[1].toLocaleString('pt-BR')} L
                    {family.catalogHeights
                      ? ` e as alturas ${family.catalogHeights.map(meters).join(' m e ')} m`
                      : ''}
                    . O modelo ao lado usa dimensões iniciais, a ajustar pelo usuário.
                  </p>
                )}
                <div className="products__notes" data-testid="tank-library-approximations">
                  <span className="section__title">Não tabulado (derivado ou representação)</span>
                  <ul>
                    {family.approximations.map((note) => (
                      <li key={note}>{note}</li>
                    ))}
                  </ul>
                </div>
                {family.remarks.length > 0 && (
                  <div className="products__notes" data-testid="tank-library-remarks">
                    <span className="section__title">Divergências do catálogo</span>
                    <ul>
                      {family.remarks.map((note) => (
                        <li key={note}>{note}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              <figure
                className="families__preview"
                data-testid="tank-preview"
                data-variant-id={variant?.id ?? 'custom'}
                data-state={model?.ok ? 'model' : 'empty'}
              >
                <div className="families__preview-view">
                  {open && model?.ok && <FamilyPreview element={model.tank} />}
                  {model && !model.ok && <p className="muted">{model.reason}</p>}
                </div>
                <figcaption className="muted">
                  {variant ? (
                    <strong>{tankVariantLabel(variant)}</strong>
                  ) : (
                    <strong>Dimensões iniciais (do usuário)</strong>
                  )}{' '}
                  Clique em uma linha para ver o modelo. Arraste para girar; role para aproximar.
                  {model?.ok && (
                    <span className="products__extent" data-testid="tank-preview-extent">
                      Topo do costado: {meters(tankLayout(model.tank).top)} m · Ø{' '}
                      {meters(model.tank.diameter)} m · volume geométrico:{' '}
                      {formatDecimal(tankGeometricVolume(model.tank), 2)} m³
                    </span>
                  )}
                </figcaption>
              </figure>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
