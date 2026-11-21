import { degToRad, radToDeg } from '@hydrobim/core';
import { X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useEditorStore } from '../state/editorStore';
import { usePrecisionStore } from '../state/precisionStore';
import { NumberField } from './fields';

interface Props {
  open: boolean;
  onClose: () => void;
}

const LENGTH_CHIPS_CM = [1, 5, 10, 50] as const;
const ANGLE_CHIPS = [1, 5, 15, 45] as const;

/**
 * Opções de projeto: precisão da modelagem (passos de comprimento e de ângulo usados pelo
 * cursor no traçado de tubos, ao esticar comprimentos e ao girar) e a grade de captura.
 */
export function ProjectOptionsDialog({ open, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const enabled = usePrecisionStore((s) => s.enabled);
  const lengthStep = usePrecisionStore((s) => s.lengthStep);
  const angleStep = usePrecisionStore((s) => s.angleStep);
  const setPrecision = usePrecisionStore((s) => s.setPrecision);
  const resetPrecision = usePrecisionStore((s) => s.resetPrecision);
  const snapToGrid = useEditorStore((s) => s.snapToGrid);
  const gridStep = useEditorStore((s) => s.gridStep);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  const lengthCm = Math.round(lengthStep * 1000) / 10;
  const angleDeg = Math.round(radToDeg(angleStep) * 100) / 100;

  return (
    <dialog
      ref={dialogRef}
      className="dialog"
      data-testid="project-options-dialog"
      onClose={onClose}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <header className="dialog__header">
        <h2>Opções de projeto</h2>
        <button
          type="button"
          className="btn btn--icon"
          onClick={onClose}
          aria-label="Fechar"
          data-testid="project-options-close"
        >
          <X size={16} />
        </button>
      </header>
      <div className="dialog__body">
        <section className="section">
          <h3 className="section__title">Precisão da modelagem</h3>
          <p className="muted">
            Passos seguidos pelo cursor ao traçar tubos (direção e comprimento de cada trecho), ao
            esticar um tubo pela alça e ao girar. Comprimentos e ângulos digitados continuam exatos.
            Ficam guardados neste navegador e valem para todos os projetos.
          </p>
          <label className="check">
            <input
              type="checkbox"
              data-testid="precision-enabled"
              checked={enabled}
              onChange={(event) => setPrecision({ enabled: event.target.checked })}
            />
            Usar os passos de precisão
          </label>
          <NumberField
            label="Passo de comprimento"
            unit="cm"
            digits={1}
            value={lengthCm}
            disabled={!enabled}
            onCommit={(value) => setPrecision({ lengthStep: value / 100 })}
            title="Trechos e alongamentos andam deste tanto em tanto (de 0,1 cm a 10 m)"
            testId="precision-length"
          />
          <div className="chips">
            {LENGTH_CHIPS_CM.map((value) => (
              <button
                key={value}
                type="button"
                disabled={!enabled}
                className={lengthCm === value ? 'chip is-active' : 'chip'}
                data-testid={`precision-length-${value}`}
                onClick={() => setPrecision({ lengthStep: value / 100 })}
              >
                {value} cm
              </button>
            ))}
          </div>
          <NumberField
            label="Passo angular"
            unit="°"
            digits={2}
            value={angleDeg}
            disabled={!enabled}
            onCommit={(value) => setPrecision({ angleStep: degToRad(value) })}
            title="Direção do trecho e ângulo do girar andam deste tanto em tanto (de 0,1° a 90°)"
            testId="precision-angle"
          />
          <div className="chips">
            {ANGLE_CHIPS.map((value) => (
              <button
                key={value}
                type="button"
                disabled={!enabled}
                className={angleDeg === value ? 'chip is-active' : 'chip'}
                data-testid={`precision-angle-${value}`}
                onClick={() => setPrecision({ angleStep: degToRad(value) })}
              >
                {value}°
              </button>
            ))}
          </div>
          <p className="muted">
            Saindo da extremidade de um tubo, os ângulos contam a partir do eixo dele (seguir reto
            fica exato). Com &quot;Somente peças de catálogo&quot; ligado, a direção ao sair de uma
            extremidade continua restrita aos joelhos que existem no catálogo — um desvio de 1°
            exigiria uma peça que não existe. Shift mantém a trava de 45°/90°.
          </p>
          <button
            type="button"
            className="btn btn--compact"
            data-testid="precision-reset"
            onClick={resetPrecision}
          >
            Restaurar padrão (5 cm e 1°)
          </button>
        </section>
        <section className="section">
          <h3 className="section__title">Grade de captura</h3>
          <label className="check">
            <input
              type="checkbox"
              data-testid="options-snap-grid"
              checked={snapToGrid}
              onChange={(event) => useEditorStore.getState().setSnapToGrid(event.target.checked)}
            />
            Capturar na grade (primeiro ponto do traçado, peças e equipamentos)
          </label>
          <NumberField
            label="Passo da grade"
            unit="cm"
            digits={1}
            value={Math.round(gridStep * 1000) / 10}
            disabled={!snapToGrid}
            onCommit={(value) => useEditorStore.getState().setGridStep(value / 100)}
            testId="options-grid-step"
          />
        </section>
      </div>
    </dialog>
  );
}
