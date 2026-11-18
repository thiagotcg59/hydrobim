import { getTankFamily, TANK_FAMILIES } from '@hydrobim/catalog';
import {
  degToRad,
  formatMeters,
  radToDeg,
  TANK_NOZZLE_ROLE_LABELS,
  TANK_NOZZLE_ROLES,
  TANK_ORIGIN_LABELS,
  TANK_TYPE_LABELS,
  tankGeometricVolume,
  tankLayout,
  tankParameterOrigins,
  tankTypeOf,
  tankVariantLabel,
  type FittingPatch,
  type Tank,
  type TankAccessories,
  type TankOriginKey,
  type TankParameterOrigin,
} from '@hydrobim/core';
import { Plus, Trash2 } from 'lucide-react';
import { useEditorStore } from '../state/editorStore';
import { NumberField, ReadOnlyRow, SelectField } from './fields';

const actions = () => useEditorStore.getState();
const formatVolume = (value: number): string =>
  `${value.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} m³`;

/** Selo com a origem do parâmetro: catálogo, derivado, estimado ou definido pelo usuário. */
function Origin({ name, origin }: { name: string; origin: TankParameterOrigin | undefined }) {
  if (!origin) return null;
  return (
    <span
      className={`badge badge--origin badge--${origin}`}
      data-testid={`tank-origin-${name}`}
      data-origin={origin}
      title={
        origin === 'catalog'
          ? 'Valor impresso no catálogo do fabricante.'
          : origin === 'derived'
            ? 'Calculado a partir de valores do catálogo.'
            : origin === 'estimated'
              ? 'O catálogo não informa: proporção adotada só para a representação.'
              : 'Informado ou alterado pelo usuário.'
      }
    >
      {TANK_ORIGIN_LABELS[origin]}
    </span>
  );
}

/** Dimensão do reservatório (m) com o selo de origem. */
function Param({
  tank,
  field,
  label,
  origin,
  disabled,
  title,
}: {
  tank: Tank;
  field: keyof FittingPatch & keyof Tank & TankOriginKey;
  label: string;
  origin: TankParameterOrigin | undefined;
  disabled?: boolean;
  title?: string;
}) {
  const value = tank[field];
  if (typeof value !== 'number') return null;
  return (
    <div className="tank-param">
      <NumberField
        label={label}
        unit="m"
        value={value}
        disabled={disabled}
        title={title}
        onCommit={(v) => actions().changeFitting(tank.id, { [field]: v })}
        testId={`prop-tank-${field}`}
      />
      <Origin name={field} origin={origin} />
    </div>
  );
}

const ACCESSORY_LABELS: [
  keyof TankAccessories & ('ladder' | 'cage' | 'guardrail' | 'manhole'),
  string,
][] = [
  ['ladder', 'Escada externa'],
  ['cage', 'Gaiola de proteção'],
  ['guardrail', 'Guarda-corpo'],
  ['manhole', 'Boca de visita'],
];

/** Geometria, modelo comercial, acessórios e bocais de um reservatório. */
export function TankProperties({ tank }: { tank: Tank }) {
  const activeSpec = useEditorStore((s) => s.activeSpec);
  const type = tankTypeOf(tank);
  const family = getTankFamily(tank.familyId);
  const layout = tankLayout(tank);
  const origins = tankParameterOrigins(tank, family);
  const base = tank.placement.position.z;
  const generic = type === 'generic';
  const heightLabel =
    type === 'australian'
      ? 'Altura do costado'
      : type === 'horizontal'
        ? 'Altura total (apoio + diâmetro)'
        : generic
          ? 'Altura'
          : 'Altura total';

  /** Dimensões atuais, para trocar de família ou desvincular do modelo sem mudar a forma. */
  const currentDimensions = {
    ...(tank.nominalCapacity !== undefined ? { capacityL: tank.nominalCapacity * 1000 } : {}),
    diameter: tank.diameter,
    ...(type === 'horizontal' ? {} : { height: tank.height }),
    ...(tank.length !== undefined ? { length: tank.length } : {}),
    ...(tank.supportType ? { supportType: tank.supportType } : {}),
  };

  return (
    <>
      <SelectField
        label="Família"
        testId="prop-tank-family"
        value={family?.id ?? 'generic'}
        options={[
          ...(generic ? [{ value: 'generic', label: 'Genérico (sem catálogo)' }] : []),
          ...TANK_FAMILIES.map((f) => ({ value: f.id, label: `${f.name} — ${f.manufacturer}` })),
        ]}
        onChange={(id) => {
          const next = getTankFamily(id);
          if (!next || next.id === family?.id) return;
          const first = next.variants[0];
          actions().changeTankModel(
            tank.id,
            next.id,
            first ? { variantId: first.id } : { custom: {} },
          );
        }}
      />
      {generic && (
        <span className="warn" data-testid="prop-tank-generic">
          Dimensões genéricas (fora de catálogo): cilindro vertical simples, sem identificação de
          produto.
        </span>
      )}
      {family && family.variants.length > 0 && (
        <SelectField
          label="Modelo comercial"
          testId="prop-tank-variant"
          value={tank.variantId ?? 'custom'}
          options={[
            ...family.variants.map((v) => ({ value: v.id, label: tankVariantLabel(v) })),
            { value: 'custom', label: 'Dimensões personalizadas' },
          ]}
          onChange={(id) =>
            actions().changeTankModel(
              tank.id,
              family.id,
              id === 'custom'
                ? {
                    custom: {
                      ...currentDimensions,
                      ...(type === 'gobletDry' && tank.columnHeight !== undefined
                        ? { columnHeight: tank.columnHeight }
                        : {}),
                    },
                  }
                : { variantId: id },
            )
          }
        />
      )}
      {family && family.variants.length === 0 && (
        <span className="muted" data-testid="prop-tank-no-table">
          O catálogo não tabula os modelos desta família (só a faixa de{' '}
          {family.capacityRangeL[0].toLocaleString('pt-BR')} a{' '}
          {family.capacityRangeL[1].toLocaleString('pt-BR')} L): as dimensões são do usuário.
        </span>
      )}
      {family && (
        <span className="muted families__source" data-testid="prop-tank-source">
          Fonte: {family.source}
        </span>
      )}

      {!generic && (
        <div className="tank-param">
          <NumberField
            label="Capacidade nominal"
            unit="L"
            digits={0}
            value={(tank.nominalCapacity ?? 0) * 1000}
            onCommit={(v) => actions().changeFitting(tank.id, { nominalCapacity: v / 1000 })}
            testId="prop-tank-capacity"
          />
          <Origin name="nominalCapacity" origin={origins.nominalCapacity} />
        </div>
      )}
      <Param
        tank={tank}
        field="diameter"
        label={type === 'gobletWet' || type === 'gobletDry' ? 'Diâmetro da taça' : 'Diâmetro'}
        origin={generic ? undefined : origins.diameter}
      />
      <Param
        tank={tank}
        field="height"
        label={heightLabel}
        origin={generic ? undefined : origins.height}
        disabled={type === 'horizontal'}
        title={type === 'horizontal' ? 'Derivada: altura do apoio mais o diâmetro.' : undefined}
      />
      <Param tank={tank} field="length" label="Comprimento" origin={origins.length} />
      <Param
        tank={tank}
        field="columnHeight"
        label="Altura da coluna"
        origin={origins.columnHeight}
      />
      <Param
        tank={tank}
        field="columnDiameter"
        label="Diâmetro da coluna"
        origin={origins.columnDiameter}
      />
      <Param
        tank={tank}
        field="coneHeight"
        label={
          type === 'gobletWet' || type === 'gobletDry'
            ? 'Altura da transição cônica'
            : 'Altura do fundo cônico'
        }
        origin={origins.coneHeight}
      />
      <Param
        tank={tank}
        field="supportHeight"
        label={type === 'horizontal' ? 'Altura do apoio' : 'Altura dos pés'}
        origin={origins.supportHeight}
      />
      {type === 'horizontal' && (
        <SelectField
          label="Apoio"
          testId="prop-tank-support"
          value={tank.supportType ?? 'skid'}
          options={[
            { value: 'skid', label: 'Longarina' },
            { value: 'legs', label: 'Pés de 0,50 m' },
          ]}
          onChange={(supportType) => actions().changeTankSettings(tank.id, { supportType })}
        />
      )}

      {!generic && (
        <>
          <div className="tank-param">
            <NumberField
              label="Espessura das chapas"
              unit="mm"
              digits={2}
              value={(tank.shellThickness ?? 0) * 1000}
              title="O catálogo não informa a espessura. Zero = não informada (o desenho usa 6 mm)."
              onCommit={(v) =>
                actions().changeTankSettings(tank.id, { shellThickness: v > 0 ? v / 1000 : null })
              }
              testId="prop-tank-thickness"
            />
            <Origin name="shellThickness" origin={origins.shellThickness} />
          </div>
          <NumberField
            label="Células internas"
            digits={0}
            value={tank.compartments ?? 1}
            title="Registrada como propriedade; a divisão interna não é desenhada."
            onCommit={(v) => actions().changeTankSettings(tank.id, { compartments: v })}
            testId="prop-tank-compartments"
          />
          <NumberField
            label="Nível máximo de água (acima da base)"
            unit="m"
            value={tank.maxWaterLevel ?? 0}
            title="Zero = não informado."
            onCommit={(v) =>
              actions().changeTankSettings(tank.id, { maxWaterLevel: v > 0 ? v : null })
            }
            testId="prop-tank-max-level"
          />
        </>
      )}

      <ReadOnlyRow
        label="Topo do costado"
        value={<span data-testid="prop-tank-top">{formatMeters(layout.top)}</span>}
      />
      <ReadOnlyRow label="Cota da base" value={formatMeters(base)} />
      <ReadOnlyRow
        label="Cota do nível máximo"
        value={tank.maxWaterLevel === undefined ? '—' : formatMeters(base + tank.maxWaterLevel)}
      />
      <ReadOnlyRow
        label="Volume geométrico"
        value={
          <span data-testid="prop-tank-volume">{formatVolume(tankGeometricVolume(tank))}</span>
        }
      />
      {!generic && <ReadOnlyRow label="Forma construtiva" value={TANK_TYPE_LABELS[type]} />}

      {tank.accessories && (
        <fieldset className="radio-group" data-testid="prop-tank-accessories">
          <legend>
            Acessórios <Origin name="accessories" origin={origins.accessories} />
          </legend>
          {ACCESSORY_LABELS.map(([key, label]) => (
            <label key={key} className="check">
              <input
                type="checkbox"
                data-testid={`prop-tank-${key}`}
                checked={tank.accessories?.[key] ?? false}
                onChange={(event) =>
                  actions().changeTankSettings(tank.id, {
                    accessories: { [key]: event.target.checked },
                  })
                }
              />
              {label}
            </label>
          ))}
          <NumberField
            label="Posição da escada"
            unit="°"
            digits={1}
            value={radToDeg(tank.accessories.ladderAzimuth)}
            onCommit={(v) =>
              actions().changeTankSettings(tank.id, { accessories: { ladderAzimuth: degToRad(v) } })
            }
            testId="prop-tank-ladder-azimuth"
          />
          <NumberField
            label="Altura do guarda-corpo"
            unit="m"
            value={tank.accessories.guardrailHeight}
            onCommit={(v) =>
              actions().changeTankSettings(tank.id, { accessories: { guardrailHeight: v } })
            }
            testId="prop-tank-guardrail-height"
          />
        </fieldset>
      )}

      <fieldset className="radio-group" data-testid="prop-tank-nozzles">
        <legend>
          Bocais <Origin name="nozzles" origin={generic ? undefined : origins.nozzles} />
        </legend>
        <NumberField
          label="Saída — altura do eixo"
          unit="m"
          value={tank.outletHeight}
          onCommit={(v) => actions().changeFitting(tank.id, { outletHeight: v })}
          testId="prop-tank-outlet"
        />
        <NumberField
          label="Entrada — altura do eixo"
          unit="m"
          value={tank.inletHeight}
          onCommit={(v) => actions().changeFitting(tank.id, { inletHeight: v })}
          testId="prop-tank-inlet"
        />
        <NumberField
          label="Comprimento dos bocais"
          unit="m"
          value={tank.nozzleLength}
          onCommit={(v) => actions().changeFitting(tank.id, { nozzleLength: v })}
          testId="prop-tank-nozzle"
        />
        {(tank.nozzles ?? []).map((nozzle) => (
          <div key={nozzle.id} className="tank-nozzle" data-testid="prop-tank-nozzle-row">
            <SelectField
              label="Função"
              value={nozzle.role}
              options={TANK_NOZZLE_ROLES.map((role) => ({
                value: role,
                label: TANK_NOZZLE_ROLE_LABELS[role],
              }))}
              onChange={(role) => actions().changeTankNozzle(tank.id, nozzle.id, { role })}
            />
            <NumberField
              label="Altura"
              unit="m"
              value={nozzle.height}
              onCommit={(height) => actions().changeTankNozzle(tank.id, nozzle.id, { height })}
              testId="prop-tank-nozzle-height"
            />
            <NumberField
              label="Direção"
              unit="°"
              digits={1}
              value={radToDeg(nozzle.azimuth)}
              onCommit={(v) =>
                actions().changeTankNozzle(tank.id, nozzle.id, { azimuth: degToRad(v) })
              }
            />
            <span className="muted">{nozzle.spec.sizeLabel}</span>
            <button
              type="button"
              className="btn btn--icon"
              title="Remover bocal"
              data-testid="prop-tank-nozzle-remove"
              onClick={() => actions().removeTankNozzle(tank.id, nozzle.id)}
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
        <div className="chips">
          {(['overflow', 'drain', 'inlet', 'outlet'] as const).map((role) => (
            <button
              key={role}
              type="button"
              className="chip"
              data-testid={`prop-tank-add-${role}`}
              onClick={() => actions().addTankNozzle(tank.id, role)}
            >
              <Plus size={12} /> {TANK_NOZZLE_ROLE_LABELS[role]}
            </button>
          ))}
        </div>
        <span className="muted">
          O novo bocal recebe a especificação ativa ({activeSpec.sizeLabel}); o catálogo do
          reservatório não define bocais.
        </span>
      </fieldset>

      {family && (
        <details className="tank-notes" data-testid="prop-tank-notes">
          <summary>O que não vem do catálogo</summary>
          <ul>
            {[...family.approximations, ...family.remarks].map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}
