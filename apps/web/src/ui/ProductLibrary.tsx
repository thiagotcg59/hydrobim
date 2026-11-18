import {
  PRODUCT_CATEGORIES,
  PRODUCT_FAMILIES,
  type ProductCategory,
  type ProductFamily,
} from '@hydrobim/catalog';
import { PackagePlus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { buildProductModel, modelExtent } from '../editor/productModel';
import { FamilyPreview } from '../viewport/FamilyPreview';
import { formatDecimal } from './fields';

const formatMm = (meters: number): string => formatDecimal(meters * 1000, 1);

interface Props {
  /** O canvas 3D só é montado com o diálogo aberto. */
  open: boolean;
}

/**
 * Biblioteca de produtos: tabelas dos fabricantes (somente leitura) e o modelo 3D gerado a
 * partir delas. Não altera o projeto — a inserção na rede continua a cargo das famílias de
 * conexões; os produtos sem tipo de elemento correspondente aparecem identificados.
 */
export function ProductLibrary({ open }: Props) {
  const [category, setCategory] = useState<ProductCategory | 'all'>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [row, setRow] = useState(0);
  const [fullLength, setFullLength] = useState(false);

  const visible = PRODUCT_FAMILIES.filter((f) => category === 'all' || f.category === category);
  const family: ProductFamily | null = PRODUCT_FAMILIES.find((f) => f.id === selectedId) ?? null;
  useEffect(() => {
    setRow(0);
  }, [selectedId]);

  const index = family ? Math.min(row, family.sizes.length - 1) : -1;
  const size = family?.sizes[index];
  const model = useMemo(
    () => (family && size ? buildProductModel(family, size, { fullLength }) : null),
    [family, size, fullLength],
  );
  const extent = useMemo(() => (model?.ok ? modelExtent(model.parts) : null), [model]);

  return (
    <div className="families" data-testid="product-library">
      <aside className="families__list">
        <label className="stack">
          <span className="section__title">Categoria</span>
          <select
            data-testid="products-category"
            value={category}
            onChange={(event) => setCategory(event.target.value as ProductCategory | 'all')}
          >
            <option value="all">Todas</option>
            {PRODUCT_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <ul className="element-list" data-testid="products-list">
          {visible.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                data-testid="product-item"
                data-product-id={item.id}
                className={
                  item.id === selectedId ? 'element-list__item is-active' : 'element-list__item'
                }
                onClick={() => setSelectedId(item.id)}
              >
                <span>{item.name}</span>
                <span className="muted">{item.manufacturer}</span>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <section className="families__detail">
        {!family && (
          <p className="muted">
            Selecione um produto para consultar a tabela do fabricante e o modelo 3D gerado a partir
            dela. As tabelas são somente leitura; as dimensões usadas na rede são editadas na aba
            Conexões.
          </p>
        )}
        {family && (
          <>
            <div className="products__header">
              <h3>{family.name}</h3>
              <button
                type="button"
                className="btn"
                data-testid="product-insert"
                disabled
                title={family.network.note}
              >
                <PackagePlus size={15} />
                {family.network.inserted ? 'Disponível na rede' : 'Inserir na rede (Fase 2)'}
              </button>
            </div>
            <p className="muted families__source">
              {family.manufacturer} · {family.standard} · Fonte: {family.source}
            </p>
            <p className="muted families__source" data-testid="product-network">
              <strong>Na rede: </strong>
              {family.network.note}
            </p>

            <div className="families__body">
              <div className="products__info">
                <div className="families__table">
                  <table data-testid="product-table">
                    <thead>
                      <tr>
                        <th>Código</th>
                        <th>Bitola</th>
                        {family.columns.map((column) => (
                          <th key={column.key} title={column.title}>
                            {column.key}
                            <small> mm</small>
                          </th>
                        ))}
                        <th>
                          Peso<small> g</small>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {family.sizes.map((item, i) => (
                        <tr
                          key={item.code}
                          data-testid="product-row"
                          data-code={item.code}
                          className={i === index ? 'is-preview' : undefined}
                          onClick={() => setRow(i)}
                          title={item.description}
                        >
                          <td>{item.code}</td>
                          <td>{item.label}</td>
                          {family.columns.map((column) => (
                            <td key={column.key}>
                              {item.dims[column.key] === undefined
                                ? '—'
                                : formatDecimal(item.dims[column.key] ?? 0, 1)}
                            </td>
                          ))}
                          <td>{formatDecimal(item.weightG, 1)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <dl className="products__legend">
                  {family.columns.map((column) => (
                    <div key={column.key}>
                      <dt>{column.key}</dt>
                      <dd>{column.title}</dd>
                    </div>
                  ))}
                </dl>
                {family.approximations.length > 0 && (
                  <div className="products__notes" data-testid="product-approximations">
                    <span className="section__title">Não tabulado (derivado ou representação)</span>
                    <ul>
                      {family.approximations.map((note) => (
                        <li key={note}>{note}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {family.remarks.length > 0 && (
                  <div className="products__notes" data-testid="product-remarks">
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
                data-testid="product-preview"
                data-code={size?.code}
                data-state={model?.ok ? 'model' : 'empty'}
              >
                <div className="families__preview-view">
                  {open && model?.ok && <FamilyPreview parts={model.parts} />}
                  {model && !model.ok && (
                    <p className="muted" data-testid="product-preview-message">
                      {model.reason}
                    </p>
                  )}
                </div>
                <figcaption className="muted">
                  {size && <strong>{size.label}</strong>} Clique em uma linha para ver o modelo.
                  Arraste para girar, role para aproximar e use o botão direito para deslocar.
                  {extent && (
                    <span className="products__extent" data-testid="product-extent">
                      Envoltória do modelo: {formatMm(extent.max[0] - extent.min[0])} ×{' '}
                      {formatMm(extent.max[1] - extent.min[1])} ×{' '}
                      {formatMm(extent.max[2] - extent.min[2])} mm
                    </span>
                  )}
                  {model?.ok && model.note && (
                    <span className="products__extent">{model.note}</span>
                  )}
                  {family.shape === 'pipe' && (
                    <label className="families__preview-toggle">
                      <input
                        type="checkbox"
                        data-testid="product-full-length"
                        checked={fullLength}
                        onChange={(event) => setFullLength(event.target.checked)}
                      />
                      Mostrar a barra inteira
                    </label>
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
