import {
  archQuantitiesToCsv,
  computeArchQuantities,
  computeSpaceSchedule,
  type Project,
} from '@hydrobim/core';
import { Download, X } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';
import { downloadText, projectFileBase } from '../persistence/fileIO';
import { useEditorStore } from '../state/editorStore';
import '../styles/architecture.css';

/**
 * Quantitativo da arquitetura, extraído do modelo: uma linha por pavimento, categoria e tipo,
 * e o quadro de ambientes. As contas são de `@hydrobim/core`; aqui só se apresenta e exporta.
 */

interface Props {
  onClose: () => void;
}

const fmt = (value: number | null, digits = 2): string =>
  value === null
    ? '—'
    : value.toLocaleString('pt-BR', {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      });

/** Nome do arquivo CSV do quantitativo de arquitetura. */
export const archQuantitiesFileName = (project: Project): string =>
  `${projectFileBase(project)}-quantitativo-arquitetura.csv`;

export function ArchQuantitiesDialog({ onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const project = useEditorStore((s) => s.project);
  const { levels, architecture } = project;
  const rows = useMemo(
    () => computeArchQuantities({ levels, architecture }),
    [levels, architecture],
  );
  const spaces = useMemo(
    () => computeSpaceSchedule({ levels, architecture }),
    [levels, architecture],
  );
  const pending = spaces.filter((space) => space.height === null).length;

  // O diálogo é montado já aberto por quem registra o comando.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  const download = (): void => {
    const store = useEditorStore.getState();
    if (rows.length === 0 && spaces.length === 0) {
      store.notify('error', 'O projeto não tem elementos de arquitetura para quantificar.');
      return;
    }
    // Mesmo mecanismo das outras exportações (quantitativo hidráulico, perfil do terreno).
    downloadText(
      archQuantitiesFileName(store.project),
      archQuantitiesToCsv(rows, spaces),
      'text/csv',
    );
    store.notify(
      'success',
      `Quantitativo de arquitetura exportado (${rows.length} linhas e ${spaces.length} ambientes).`,
    );
  };

  return (
    <dialog
      ref={dialogRef}
      className="dialog dialog--wide"
      data-testid="arch-quantities-dialog"
      aria-label="Quantitativo de arquitetura"
      onClose={onClose}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <header className="dialog__header">
        <h2>Quantitativo de arquitetura</h2>
        <button
          type="button"
          className="btn btn--icon"
          onClick={onClose}
          aria-label="Fechar"
          data-testid="arch-quantities-close"
        >
          <X size={16} />
        </button>
      </header>
      <div className="dialog__body dialog__body--tall">
        <p className="archqty__note" data-testid="arch-quantities-note">
          <strong>Bruto</strong> não desconta vãos nem aberturas; <strong>líquido</strong> desconta
          os vãos de portas e janelas (paredes) e as aberturas (lajes e revestimentos). Cada
          elemento entra uma única vez, na sua categoria: o ambiente não soma paredes, lajes nem
          pisos, e o revestimento não soma a laje. “NC” = tipo não classificado (sem código
          informado).
        </p>

        <h3 className="section__title">Elementos por pavimento, categoria e tipo</h3>
        {rows.length === 0 ? (
          <p className="muted" data-testid="arch-quantities-empty">
            Nenhum elemento de arquitetura no projeto.
          </p>
        ) : (
          <div className="archqty__table">
            <table data-testid="arch-quantities-table">
              <thead>
                <tr>
                  <th>Pavimento</th>
                  <th>Categoria</th>
                  <th>Tipo</th>
                  <th>Dimensão</th>
                  <th>NBR 15965</th>
                  <th>SINAPI</th>
                  <th className="num">Quantidade</th>
                  <th className="num">Comprimento (m)</th>
                  <th className="num">Área bruta (m²)</th>
                  <th className="num">Área líquida (m²)</th>
                  <th
                    className="num"
                    title="Telhados: projeção horizontal, com os beirais. As áreas bruta e líquida do telhado são a área inclinada das águas."
                  >
                    Projeção horizontal (m²)
                  </th>
                  <th className="num">Volume bruto (m³)</th>
                  <th className="num">Volume líquido (m³)</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={index} data-testid="arch-quantities-row">
                    <td>{row.level}</td>
                    <td>{row.category}</td>
                    <td>{row.type}</td>
                    <td>{row.size}</td>
                    <td data-testid="arch-quantities-nbr">{row.nbr15965}</td>
                    <td data-testid="arch-quantities-sinapi">{row.sinapi}</td>
                    <td className="num">{row.count}</td>
                    <td className="num">{fmt(row.length)}</td>
                    <td className="num">{fmt(row.grossArea)}</td>
                    <td className="num">{fmt(row.netArea)}</td>
                    <td className="num" data-testid="arch-quantities-projected">
                      {fmt(row.projectedArea)}
                    </td>
                    <td className="num">{fmt(row.grossVolume, 3)}</td>
                    <td className="num">{fmt(row.netVolume, 3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <h3 className="section__title">Quadro de ambientes</h3>
        {spaces.length === 0 ? (
          <p className="muted" data-testid="arch-spaces-empty">
            Nenhum ambiente no projeto.
          </p>
        ) : (
          <>
            <div className="archqty__table">
              <table data-testid="arch-spaces-table">
                <thead>
                  <tr>
                    <th>Pavimento</th>
                    <th>Número</th>
                    <th>Ambiente</th>
                    <th className="num">Área (m²)</th>
                    <th className="num">Perímetro (m)</th>
                    <th className="num">Pé-direito (m)</th>
                    <th className="num">Volume (m³)</th>
                  </tr>
                </thead>
                <tbody>
                  {spaces.map((row, index) => (
                    <tr
                      key={index}
                      data-testid="arch-spaces-row"
                      data-pending={row.height === null || undefined}
                    >
                      <td>{row.level}</td>
                      <td>{row.number || '—'}</td>
                      <td>{row.name}</td>
                      <td className="num">{fmt(row.area)}</td>
                      <td className="num">{fmt(row.perimeter)}</td>
                      <td className="num">
                        {row.height === null ? (
                          <span className="archcat__pending" data-testid="arch-space-pending">
                            pendente
                          </span>
                        ) : (
                          fmt(row.height)
                        )}
                      </td>
                      <td className="num">
                        {row.volume === null ? (
                          <span className="archcat__pending">pendente</span>
                        ) : (
                          fmt(row.volume, 3)
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {pending > 0 && (
              <p className="archqty__note" data-testid="arch-spaces-pending-note">
                Pendente = pé-direito não informado no ambiente; sem ele não há volume, e nenhum
                valor é presumido (no CSV as células ficam vazias).
              </p>
            )}
          </>
        )}
      </div>
      <footer className="dialog__footer">
        <button
          type="button"
          className="btn btn--primary"
          data-testid="arch-quantities-csv"
          disabled={rows.length === 0 && spaces.length === 0}
          title="Baixa o quantitativo e o quadro de ambientes em CSV (ponto e vírgula, vírgula decimal)"
          onClick={download}
        >
          <Download size={14} aria-hidden /> Baixar CSV
        </button>
      </footer>
    </dialog>
  );
}
