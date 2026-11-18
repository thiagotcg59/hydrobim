import { describe, expect, it } from 'vitest';
import { connectedPortRef, getElement } from './connectivity';
import { exportEpanet } from './epanet';
import { createProject, drawPipe, placeEquipment, updateFitting } from './operations';
import { getPorts } from './ports';
import { computeQuantities } from './quantities';
import { SCHEMA_VERSION, type PipeSpec, type Project, type Tank } from './schema';
import { parseProject, serializeProject } from './serialization';
import {
  addTankNozzle,
  applyTankFamilyToInstances,
  duplicateTankFamily,
  removeTankFamily,
  removeTankNozzle,
  tankFamiliesOf,
  upsertTankFamily,
  setTankModel,
  updateTankNozzle,
  updateTankSettings,
} from './tankOps';
import {
  tankGeometricVolume,
  tankHydraulics,
  tankLayout,
  tankParameterOrigins,
  tankParametersFromFamily,
  type TankFamily,
  type TankSelection,
} from './tanks';
import { validateProject } from './validation';
import { vec3 } from './math';

const spec: PipeSpec = {
  specificationId: 'teste',
  material: 'ductileIron',
  standard: 'Norma de teste',
  jointType: 'flanged',
  pressureClass: null,
  dn: 100,
  sizeLabel: 'DN 100',
  outerDiameter: 0.118,
  innerDiameter: 0.106,
  wallThickness: 0.006,
};
const smaller: PipeSpec = {
  ...spec,
  dn: 50,
  sizeLabel: 'DN 50',
  outerDiameter: 0.066,
  innerDiameter: 0.054,
};

const base = {
  manufacturer: 'Fabricante de teste',
  material: 'Aço-carbono estrutural',
  source: 'Catálogo de teste, p. 1',
  page: 1,
  description: '',
  approximations: [],
  remarks: [],
  origin: 'builtin',
} as const;

/** Famílias de teste (o catálogo real é conferido em `packages/catalog`). */
const DRY: TankFamily = {
  ...base,
  id: 'taca-seca',
  name: 'Taça sem água na coluna',
  tankType: 'gobletDry',
  capacityRangeL: [2000, 60000],
  customDefaults: { capacityL: 10000, diameter: 1.91, height: 7.1 },
  variants: [
    { id: 'taca-seca/10000-710', capacityL: 10000, height: 7.1, diameter: 1.91, columnHeight: 3.6 },
    { id: 'taca-seca/10000-830', capacityL: 10000, height: 8.3, diameter: 1.91, columnHeight: 4.8 },
  ],
};
const WET: TankFamily = {
  ...base,
  id: 'taca-molhada',
  name: 'Taça com água na coluna',
  tankType: 'gobletWet',
  capacityRangeL: [5000, 80000],
  customDefaults: { capacityL: 10000, diameter: 1.91, height: 7.05 },
  variants: [{ id: 'taca-molhada/10000', capacityL: 10000, height: 7.05, diameter: 1.91 }],
};
const CONE: TankFamily = {
  ...base,
  id: 'fundo-conico',
  name: 'Fundo cônico com pés',
  tankType: 'verticalConeLegs',
  capacityRangeL: [5000, 60000],
  catalogSupportHeight: 0.5,
  customDefaults: { capacityL: 10000, diameter: 2.32, height: 2.9 },
  variants: [{ id: 'fundo-conico/10000', capacityL: 10000, height: 2.9, diameter: 2.32 }],
};
const AUSTRALIAN: TankFamily = {
  ...base,
  id: 'australiano',
  name: 'Australiano',
  tankType: 'australian',
  capacityRangeL: [4300, 540000],
  catalogHeights: [0.9, 1.72],
  customDefaults: { capacityL: 20000, diameter: 5.319, height: 0.9 },
  variants: [],
};
const HORIZONTAL: TankFamily = {
  ...base,
  id: 'horizontal',
  name: 'Cilíndrico horizontal',
  tankType: 'horizontal',
  capacityRangeL: [2000, 20000],
  catalogSupportHeight: 0.5,
  customDefaults: { capacityL: 10000, diameter: 1.91, height: 2.06, length: 3.6 },
  variants: [],
};

function place(
  family: TankFamily,
  selection: TankSelection,
  project: Project = createProject('Teste', 'infra'),
): { project: Project; tank: Tank } {
  const parameters = tankParametersFromFamily(family, selection);
  if (!parameters.ok) throw new Error(parameters.error.message);
  const placed = placeEquipment(project, {
    spec,
    fitting: { kind: 'tank', parameters: parameters.value },
    position: vec3(0, 0, 10),
  });
  if (!placed.ok) throw new Error(placed.error.message);
  return {
    project: placed.value.project,
    tank: tankOf(placed.value.project, placed.value.elementId),
  };
}

function tankOf(project: Project, id: string): Tank {
  const element = getElement(project, id);
  if (element?.kind !== 'tank') throw new Error('Reservatório inexistente.');
  return element;
}

describe('parâmetros de reservatórios a partir da família', () => {
  it('carrega as dimensões do modelo comercial e identifica fabricante e modelo', () => {
    const { project, tank } = place(DRY, { variantId: 'taca-seca/10000-830' });
    expect(tank).toMatchObject({
      tankType: 'gobletDry',
      familyId: 'taca-seca',
      variantId: 'taca-seca/10000-830',
      nominalCapacity: 10,
      diameter: 1.91,
      height: 8.3,
      columnHeight: 4.8,
      manufacturing: { manufacturer: 'Fabricante de teste' },
    });
    expect(tank.manufacturing.model).toContain('10.000 L');
    expect(validateProject(project)).toEqual([]);
  });

  it('recusa modelo inexistente e dimensões inválidas', () => {
    const missing = tankParametersFromFamily(DRY, { variantId: 'nao-existe' });
    expect(missing.ok ? '' : missing.error.code).toBe('TANK_VARIANT_NOT_FOUND');
    const invalid = tankParametersFromFamily(DRY, { custom: { diameter: -1 } });
    expect(invalid.ok ? '' : invalid.error.code).toBe('INVALID_VALUE');
    // Coluna mais alta que o reservatório.
    const tall = tankParametersFromFamily(DRY, { custom: { height: 3, columnHeight: 3.6 } });
    expect(tall.ok ? '' : tall.error.code).toBe('INVALID_VALUE');
  });

  it('estima só o que o catálogo não tabula, e o volume geométrico confere com o nominal', () => {
    const dry = place(DRY, { variantId: 'taca-seca/10000-710' }).tank;
    expect(dry.columnDiameter).toBeCloseTo(0.955, 6);
    expect(dry.coneHeight).toBeCloseTo(0.382, 6);
    expect(tankGeometricVolume(dry)).toBeGreaterThan(9);
    expect(tankGeometricVolume(dry)).toBeLessThan(11);

    // Com água na coluna, a altura da coluna é a que fecha a capacidade nominal.
    const wet = place(WET, { variantId: 'taca-molhada/10000' }).tank;
    expect(wet.columnHeight).toBeGreaterThan(3);
    expect(wet.columnHeight).toBeLessThan(6);
    expect(tankGeometricVolume(wet)).toBeCloseTo(10, 1);

    const cone = place(CONE, { variantId: 'fundo-conico/10000' }).tank;
    expect(cone).toMatchObject({ supportHeight: 0.5, coneHeight: 0.4 });
    expect(tankLayout(cone)).toMatchObject({ top: 2.9, shellBottom: 0.5 });

    // Australiano: diâmetro derivado da capacidade e da altura do costado.
    const australian = place(AUSTRALIAN, { custom: { capacityL: 50000, height: 1.72 } }).tank;
    expect(australian.diameter).toBeCloseTo(Math.sqrt((4 * 50) / (Math.PI * 1.72)), 3);
    expect(tankLayout(australian).top).toBeCloseTo(1.72 + 0.35, 9);

    const horizontal = place(HORIZONTAL, { custom: {} }).tank;
    expect(horizontal).toMatchObject({ supportType: 'skid', length: 3.6, height: 0.15 + 1.91 });
    expect(tankGeometricVolume(horizontal)).toBeCloseTo(10, 0);
  });

  it('distingue catálogo, derivado, estimado e usuário', () => {
    const { project, tank } = place(DRY, { variantId: 'taca-seca/10000-830' });
    expect(tankParameterOrigins(tank, DRY)).toMatchObject({
      nominalCapacity: 'catalog',
      diameter: 'catalog',
      height: 'catalog',
      columnHeight: 'catalog',
      columnDiameter: 'estimated',
      coneHeight: 'estimated',
      shellThickness: 'estimated',
      nozzles: 'user',
    });
    const edited = updateFitting(project, tank.id, { columnDiameter: 1.2, shellThickness: 0.005 });
    if (!edited.ok) throw new Error(edited.error.message);
    expect(tankParameterOrigins(tankOf(edited.value, tank.id), DRY)).toMatchObject({
      diameter: 'catalog',
      columnDiameter: 'user',
      shellThickness: 'user',
    });
    // Sem a família, nada pode ser atribuído ao catálogo.
    expect(tankParameterOrigins(tank).diameter).toBe('user');

    const wet = place(WET, { variantId: 'taca-molhada/10000' }).tank;
    expect(tankParameterOrigins(wet, WET).columnHeight).toBe('estimated');
    const cone = place(CONE, { variantId: 'fundo-conico/10000' }).tank;
    expect(tankParameterOrigins(cone, CONE)).toMatchObject({
      supportHeight: 'catalog',
      coneHeight: 'estimated',
    });
    const australian = place(AUSTRALIAN, { custom: { capacityL: 50000, height: 1.72 } }).tank;
    expect(tankParameterOrigins(australian, AUSTRALIAN)).toMatchObject({
      height: 'catalog',
      diameter: 'derived',
      nominalCapacity: 'user',
    });
  });
});

describe('edição de reservatórios de catálogo', () => {
  it('editar uma dimensão de catálogo mantém a família e desfaz o vínculo com o modelo', () => {
    const { project, tank } = place(DRY, { variantId: 'taca-seca/10000-830' });
    const result = updateFitting(project, tank.id, { height: 9 });
    if (!result.ok) throw new Error(result.error.message);
    const edited = tankOf(result.value, tank.id);
    expect(edited.id).toBe(tank.id);
    expect(edited.familyId).toBe('taca-seca');
    expect(edited.variantId).toBeUndefined();
    expect(edited.manufacturing.model).toContain('personalizadas');
    expect(tankParameterOrigins(edited, DRY).height).toBe('user');
    expect(validateProject(result.value)).toEqual([]);

    // Parâmetro de representação: o modelo comercial continua o mesmo.
    const cone = updateFitting(project, tank.id, { coneHeight: 0.5 });
    expect(cone.ok && tankOf(cone.value, tank.id).variantId).toBe('taca-seca/10000-830');
  });

  it('recusa parâmetros que não se aplicam à forma e combinações impossíveis', () => {
    const { project, tank } = place(CONE, { variantId: 'fundo-conico/10000' });
    const column = updateFitting(project, tank.id, { columnHeight: 2 });
    expect(column.ok ? '' : column.error.code).toBe('INVALID_FIELD');
    const cone = updateFitting(project, tank.id, { coneHeight: 0.8 });
    expect(cone.ok ? '' : cone.error.code).toBe('INVALID_VALUE');
    // Bocal abaixo da base do costado (dentro da altura dos pés).
    const nozzle = updateFitting(project, tank.id, { outletHeight: 0.2 });
    expect(nozzle.ok ? '' : nozzle.error.message).toContain('costado');
  });

  it('troca o modelo comercial preservando identidade, bocais e tubos conectados', () => {
    const { project, tank } = place(DRY, { variantId: 'taca-seca/10000-710' });
    const piped = drawPipe(project, {
      spec,
      start: getPorts(tank)[0]?.position ?? vec3(0, 0, 0),
      end: vec3(6, 0, 10.3),
      fromPort: { elementId: tank.id, portId: 'a' },
    });
    if (!piped.ok) throw new Error(piped.error.message);
    const withNozzle = addTankNozzle(piped.value.project, tank.id, {
      role: 'overflow',
      height: 6.5,
      azimuth: Math.PI / 2,
      spec: smaller,
    });
    if (!withNozzle.ok) throw new Error(withNozzle.error.message);

    const next = tankParametersFromFamily(DRY, { variantId: 'taca-seca/10000-830' });
    if (!next.ok) throw new Error(next.error.message);
    const swapped = setTankModel(withNozzle.value.project, tank.id, next.value);
    if (!swapped.ok) throw new Error(swapped.error.message);
    const after = tankOf(swapped.value, tank.id);
    expect(after).toMatchObject({
      height: 8.3,
      columnHeight: 4.8,
      variantId: 'taca-seca/10000-830',
    });
    expect(after.nozzles).toHaveLength(1);
    expect(after.name).toBe(tank.name);
    expect(connectedPortRef(swapped.value, { elementId: tank.id, portId: 'a' })).toBeDefined();
    expect(validateProject(swapped.value)).toEqual([]);

    // Outra forma construtiva: as alturas dos bocais passam a ser as da nova forma.
    const cone = tankParametersFromFamily(CONE, { variantId: 'fundo-conico/10000' });
    if (!cone.ok) throw new Error(cone.error.message);
    const reshaped = setTankModel(project, tank.id, cone.value);
    if (!reshaped.ok) throw new Error(reshaped.error.message);
    const coneTank = tankOf(reshaped.value, tank.id);
    expect(coneTank.tankType).toBe('verticalConeLegs');
    expect(coneTank.columnHeight).toBeUndefined();
    expect(coneTank.outletHeight).toBeGreaterThanOrEqual(0.5);
    expect(validateProject(reshaped.value)).toEqual([]);
  });

  it('configura apoio, células, espessura, nível máximo e acessórios', () => {
    const { project, tank } = place(HORIZONTAL, { custom: {} });
    const legs = updateTankSettings(project, tank.id, { supportType: 'legs' });
    if (!legs.ok) throw new Error(legs.error.message);
    const onLegs = tankOf(legs.value, tank.id);
    expect(onLegs).toMatchObject({ supportType: 'legs', supportHeight: 0.5, height: 2.41 });
    expect(onLegs.outletHeight - tank.outletHeight).toBeCloseTo(0.35, 9);
    expect(tankParameterOrigins(onLegs, HORIZONTAL).supportHeight).toBe('catalog');
    expect(validateProject(legs.value)).toEqual([]);

    const settings = updateTankSettings(project, tank.id, {
      compartments: 2,
      shellThickness: 0.00635,
      maxWaterLevel: 1.9,
      accessories: { ladder: false },
    });
    if (!settings.ok) throw new Error(settings.error.message);
    const configured = tankOf(settings.value, tank.id);
    expect(configured).toMatchObject({
      compartments: 2,
      shellThickness: 0.00635,
      maxWaterLevel: 1.9,
    });
    expect(configured.accessories?.ladder).toBe(false);
    const cleared = updateTankSettings(settings.value, tank.id, { shellThickness: null });
    expect(cleared.ok && tankOf(cleared.value, tank.id).shellThickness).toBeUndefined();

    const errors = [
      updateTankSettings(project, tank.id, { compartments: 1.5 }),
      updateTankSettings(project, tank.id, { maxWaterLevel: 5 }),
      updateTankSettings(project, tank.id, { shellThickness: -1 }),
      updateTankSettings(project, 'nao-existe', { compartments: 2 }),
    ].map((result) => (result.ok ? '' : result.error.code));
    expect(errors).toEqual(['INVALID_VALUE', 'INVALID_VALUE', 'INVALID_VALUE', 'NOT_A_TANK']);
    const vertical = place(CONE, { variantId: 'fundo-conico/10000' });
    const support = updateTankSettings(vertical.project, vertical.tank.id, { supportType: 'legs' });
    expect(support.ok ? '' : support.error.code).toBe('INVALID_FIELD');
  });
});

describe('bocais adicionais', () => {
  it('cria portas com função, posição e diâmetro próprios', () => {
    const { project, tank } = place(CONE, { variantId: 'fundo-conico/10000' });
    const added = addTankNozzle(project, tank.id, {
      role: 'overflow',
      height: 2.7,
      azimuth: Math.PI / 2,
      spec: smaller,
    });
    if (!added.ok) throw new Error(added.error.message);
    const ports = getPorts(tankOf(added.value.project, tank.id));
    expect(ports.map((p) => p.label)).toEqual(['Saída', 'Entrada', 'Extravasor']);
    const overflow = ports[2];
    expect(overflow?.ref.portId).toBe(added.value.portId);
    expect(overflow?.spec.dn).toBe(50);
    expect(overflow?.localPosition.x).toBeCloseTo(0, 9);
    expect(overflow?.localPosition.y).toBeCloseTo(2.32 / 2 + tank.nozzleLength, 9);
    expect(overflow?.localPosition.z).toBe(2.7);
    expect(overflow?.localDirection.y).toBeCloseTo(1, 9);
    // Entrada e saída continuam opostas, em ±X.
    expect(ports[0]?.localDirection).toEqual(vec3(1, 0, 0));
    expect(ports[1]?.localDirection).toEqual(vec3(-1, 0, 0));
    expect(validateProject(added.value.project)).toEqual([]);

    const moved = updateTankNozzle(added.value.project, tank.id, added.value.portId, {
      role: 'drain',
      height: 0.6,
    });
    if (!moved.ok) throw new Error(moved.error.message);
    expect(getPorts(tankOf(moved.value, tank.id))[2]?.label).toBe('Descarga');

    const outside = addTankNozzle(project, tank.id, {
      role: 'drain',
      height: 0.1,
      azimuth: 0,
      spec,
    });
    expect(outside.ok ? '' : outside.error.code).toBe('INVALID_VALUE');
  });

  it('não remove nem redimensiona um bocal conectado', () => {
    const { project, tank } = place(CONE, { variantId: 'fundo-conico/10000' });
    const added = addTankNozzle(project, tank.id, {
      role: 'overflow',
      height: 2.5,
      azimuth: 0.5,
      spec,
    });
    if (!added.ok) throw new Error(added.error.message);
    const port = getPorts(tankOf(added.value.project, tank.id))[2];
    if (!port) throw new Error('Bocal sem porta.');
    const piped = drawPipe(added.value.project, {
      spec,
      start: port.position,
      end: vec3(
        port.position.x + port.direction.x * 2,
        port.position.y + port.direction.y * 2,
        port.position.z,
      ),
      fromPort: port.ref,
    });
    if (!piped.ok) throw new Error(piped.error.message);
    const id = added.value.portId;
    const removal = removeTankNozzle(piped.value.project, tank.id, id);
    expect(removal.ok ? '' : removal.error.code).toBe('PORT_OCCUPIED');
    const resize = updateTankNozzle(piped.value.project, tank.id, id, { spec: smaller });
    expect(resize.ok ? '' : resize.error.code).toBe('PORT_OCCUPIED');
    // Subir o bocal inclinaria o tubo horizontal conectado: a operação é recusada inteira.
    const raised = updateTankNozzle(piped.value.project, tank.id, id, { height: 2.7 });
    expect(raised.ok ? '' : raised.error.code).toBe('COUPLING_BROKEN');

    const free = removeTankNozzle(added.value.project, tank.id, id);
    expect(free.ok && tankOf(free.value, tank.id).nozzles).toEqual([]);
    const missing = removeTankNozzle(project, tank.id, 'nao-existe');
    expect(missing.ok ? '' : missing.error.code).toBe('PORT_NOT_FOUND');
  });
});

describe('reservatórios de catálogo nas exportações e na persistência', () => {
  it('salva e reabre sem perdas; documentos do esquema 5 continuam válidos', () => {
    const { project, tank } = place(DRY, { variantId: 'taca-seca/10000-830' });
    const withNozzle = addTankNozzle(project, tank.id, {
      role: 'overflow',
      height: 7.5,
      azimuth: 1,
      spec,
    });
    if (!withNozzle.ok) throw new Error(withNozzle.error.message);
    const reopened = parseProject(serializeProject(withNozzle.value.project));
    expect(reopened.ok && reopened.value).toEqual(withNozzle.value.project);

    const generic = placeEquipment(createProject('Antigo'), {
      spec,
      fitting: { kind: 'tank' },
      position: vec3(0, 0, 0),
    });
    if (!generic.ok) throw new Error(generic.error.message);
    const legacy = parseProject(
      JSON.stringify({ ...JSON.parse(serializeProject(generic.value.project)), schemaVersion: 5 }),
    );
    expect(legacy.ok && legacy.value.schemaVersion).toBe(SCHEMA_VERSION);
    expect(legacy.ok && legacy.value.elements).toEqual(generic.value.project.elements);
  });

  it('descreve o reservatório no quantitativo', () => {
    const { project } = place(DRY, { variantId: 'taca-seca/10000-830' });
    expect(computeQuantities(project)[0]?.description).toBe(
      'Reservatório tipo taça sem água na coluna Fabricante de teste — 10.000 L — Ø 1,91 m × 8,3 m',
    );
  });

  it('leva ao EPANET o fundo e o nível do volume de água', () => {
    const dry = place(DRY, { variantId: 'taca-seca/10000-830' });
    expect(tankHydraulics(dry.tank)).toMatchObject({ bottom: 4.8, approximate: true });
    expect(tankHydraulics(dry.tank).maxLevel).toBeCloseTo(3.5, 9);
    const piped = drawPipe(dry.project, {
      spec,
      start: getPorts(dry.tank)[0]?.position ?? vec3(0, 0, 0),
      end: vec3(8, 0, 10.3),
      fromPort: { elementId: dry.tank.id, portId: 'a' },
    });
    if (!piped.ok) throw new Error(piped.error.message);
    const { inp, warnings } = exportEpanet(piped.value.project);
    // Base na cota 10 + 4,80 m de coluna seca.
    expect(inp).toMatch(/\[TANKS\][\s\S]*14\.8/);
    expect(warnings.some((w) => w.includes('cilindro equivalente'))).toBe(true);

    const ground: TankFamily = { ...DRY, id: 'apoiado', tankType: 'verticalGround', variants: [] };
    const flat = place(ground, { custom: { diameter: 2.32, height: 2.4 } }).tank;
    expect(tankHydraulics(flat)).toEqual({
      bottom: 0,
      maxLevel: 2.4,
      diameter: 2.32,
      approximate: false,
    });
  });
});

describe('famílias de reservatórios personalizadas', () => {
  const duplicated = () => {
    const base = place(DRY, { variantId: 'taca-seca/10000-830' });
    const copy = duplicateTankFamily(base.project, DRY);
    if (!copy.ok) throw new Error(copy.error.message);
    const family = copy.value.project.tankFamilies[0];
    if (!family) throw new Error('Família não gravada.');
    return { project: copy.value.project, family, original: base.tank };
  };

  it('duplica a família de catálogo com a mesma tabela, identificada como do usuário', () => {
    const { project, family } = duplicated();
    expect(family).toMatchObject({
      origin: 'custom',
      basedOn: 'taca-seca',
      tankType: 'gobletDry',
      manufacturer: 'Personalizado',
    });
    expect(family.id).not.toBe(DRY.id);
    expect(family.name).toBe('Taça sem água na coluna (personalizado)');
    expect(family.source).toContain('Catálogo de teste, p. 1');
    expect(family.variants.map((v) => [v.capacityL, v.height, v.diameter, v.columnHeight])).toEqual(
      DRY.variants.map((v) => [v.capacityL, v.height, v.diameter, v.columnHeight]),
    );
    expect(family.variants.every((v) => v.id.startsWith(`${family.id}/`))).toBe(true);
    expect(tankFamiliesOf(project, [DRY]).map((f) => f.origin)).toEqual(['builtin', 'custom']);
    // A família de catálogo não é alterada, e o projeto reabre com a personalizada.
    expect(DRY.variants).toHaveLength(2);
    const reopened = parseProject(serializeProject(project));
    expect(reopened.ok && reopened.value.tankFamilies).toEqual([family]);
    expect(validateProject(project)).toEqual([]);
  });

  it('edita a tabela, e os valores passam a ser do usuário — não do catálogo', () => {
    const { project, family } = duplicated();
    const first = family.variants[0];
    if (!first) throw new Error('Família sem linhas.');
    const edited = {
      ...family,
      variants: [{ ...first, height: 7.5, columnHeight: 4 }, ...family.variants.slice(1)],
    };
    const saved = upsertTankFamily(project, edited);
    if (!saved.ok) throw new Error(saved.error.message);
    const parameters = tankParametersFromFamily(edited, { variantId: first.id });
    if (!parameters.ok) throw new Error(parameters.error.message);
    expect(parameters.value).toMatchObject({ height: 7.5, columnHeight: 4, familyId: family.id });
    const placed = placeEquipment(saved.value, {
      spec,
      fitting: { kind: 'tank', parameters: parameters.value },
      position: vec3(20, 0, 0),
    });
    if (!placed.ok) throw new Error(placed.error.message);
    const tank = tankOf(placed.value.project, placed.value.elementId);
    expect(tank.manufacturing.manufacturer).toBe('Personalizado');
    expect(tankParameterOrigins(tank, edited)).toMatchObject({
      height: 'user',
      diameter: 'user',
      columnHeight: 'user',
      columnDiameter: 'estimated',
    });
  });

  it('recusa editar o catálogo embutido e tabelas incoerentes', () => {
    const { project, family } = duplicated();
    const builtin = upsertTankFamily(project, DRY);
    expect(builtin.ok ? '' : builtin.error.code).toBe('TANK_FAMILY_READONLY');
    const first = family.variants[0];
    if (!first) throw new Error('Família sem linhas.');
    // Coluna mais alta que o reservatório.
    const tall = upsertTankFamily(project, {
      ...family,
      variants: [{ ...first, columnHeight: 9 }],
    });
    expect(tall.ok ? '' : tall.error.message).toContain('Linha 1');
    const negative = upsertTankFamily(project, {
      ...family,
      variants: [{ ...first, diameter: -1 }],
    });
    expect(negative.ok ? '' : negative.error.message).toContain('Linha 1');
    const repeated = upsertTankFamily(project, { ...family, variants: [first, first] });
    expect(repeated.ok ? '' : repeated.error.message).toContain('Linha 2');
    const unnamed = upsertTankFamily(project, { ...family, name: '' });
    expect(unnamed.ok ? '' : unnamed.error.code).toBe('INVALID_VALUE');
  });

  it('reaplica a tabela aos reservatórios do projeto e desfaz o vínculo de linhas removidas', () => {
    const { project, family } = duplicated();
    const [first, second] = family.variants;
    if (!first || !second) throw new Error('Família sem linhas.');
    const place2 = (variantId: string, x: number, from: Project) => {
      const parameters = tankParametersFromFamily(family, { variantId });
      if (!parameters.ok) throw new Error(parameters.error.message);
      const placed = placeEquipment(from, {
        spec,
        fitting: { kind: 'tank', parameters: parameters.value },
        position: vec3(x, 0, 0),
      });
      if (!placed.ok) throw new Error(placed.error.message);
      return placed.value;
    };
    const a = place2(first.id, 20, project);
    const b = place2(second.id, 30, a.project);

    const edited = { ...family, variants: [{ ...first, diameter: 2.2, height: 7.4 }] };
    const saved = upsertTankFamily(b.project, edited);
    if (!saved.ok) throw new Error(saved.error.message);
    const applied = applyTankFamilyToInstances(saved.value, edited);
    if (!applied.ok) throw new Error(applied.error.message);
    expect(applied.value.updated).toBe(2);
    expect(tankOf(applied.value.project, a.elementId)).toMatchObject({
      diameter: 2.2,
      height: 7.4,
      variantId: first.id,
    });
    const detached = tankOf(applied.value.project, b.elementId);
    expect(detached.variantId).toBeUndefined();
    expect(detached).toMatchObject({ familyId: family.id, height: second.height });
    expect(validateProject(applied.value.project)).toEqual([]);

    // Excluir a família mantém a forma e as dimensões dos reservatórios.
    const removed = removeTankFamily(applied.value.project, family.id);
    if (!removed.ok) throw new Error(removed.error.message);
    expect(removed.value.tankFamilies).toEqual([]);
    expect(tankOf(removed.value, a.elementId)).toMatchObject({
      familyId: null,
      tankType: 'gobletDry',
      diameter: 2.2,
    });
    expect(validateProject(removed.value)).toEqual([]);
    const missing = removeTankFamily(removed.value, family.id);
    expect(missing.ok ? '' : missing.error.code).toBe('TANK_FAMILY_NOT_FOUND');
  });
});
