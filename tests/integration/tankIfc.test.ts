import { getTankFamily, TANK_FAMILIES } from '@hydrobim/catalog';
import {
  addTankNozzle,
  createProject,
  getElement,
  placeEquipment,
  tankParametersFromFamily,
  updateTankSettings,
  validateProject,
  vec3,
  type PipeSpec,
  type Project,
  type Result,
} from '@hydrobim/core';
import { exportIfc, toIfcGuid } from '@hydrobim/ifc';
import { describe, expect, it } from 'vitest';

const timestamp = new Date('2026-01-01T00:00:00Z');
const spec: PipeSpec = {
  specificationId: 'ferro-ductil-nbr7675-k9',
  material: 'ductileIron',
  standard: 'ABNT NBR 7675',
  jointType: 'socketSpigot',
  pressureClass: 'K9',
  dn: 100,
  sizeLabel: 'DN 100',
  outerDiameter: 0.118,
  innerDiameter: 0.1058,
  wallThickness: 0.0061,
};

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

function placeTank(project: Project, familyId: string, variantIndex: number | null, x: number) {
  const family = getTankFamily(familyId);
  if (!family) throw new Error(`Família inexistente: ${familyId}`);
  const parameters = unwrap(
    tankParametersFromFamily(
      family,
      variantIndex === null
        ? { custom: {} }
        : { variantId: family.variants[variantIndex]?.id ?? '' },
    ),
  );
  return unwrap(
    placeEquipment(project, {
      spec,
      fitting: { kind: 'tank', parameters },
      position: vec3(x, 0, 100),
    }),
  );
}

interface Entity {
  ref: string;
  type: string;
  raw: string;
}
const entities = (text: string): Entity[] =>
  [...text.matchAll(/^(#\d+)=(\w+)\((.*)\);$/gm)].map((match) => ({
    ref: match[1] ?? '',
    type: match[2] ?? '',
    raw: match[3] ?? '',
  }));
const byType = (all: Entity[], type: string): Entity[] =>
  all.filter((e) => e.type === type.toUpperCase());

/** Valores das propriedades de um conjunto, pelo nome (texto STEP do valor). */
function propertiesOf(all: Entity[], setName: string, ownerRef?: string): Map<string, string> {
  const sets = byType(all, 'IfcPropertySet').filter((e) => e.raw.includes(`'${setName}'`));
  const set = ownerRef
    ? sets.find((candidate) =>
        byType(all, 'IfcRelDefinesByProperties').some(
          (rel) => rel.raw.includes(`(${ownerRef})`) && rel.raw.endsWith(`,${candidate.ref}`),
        ),
      )
    : sets[0];
  if (!set) throw new Error(`Conjunto ausente: ${setName}`);
  const refs = /\(((?:#\d+,?)+)\)$/.exec(set.raw)?.[1]?.split(',') ?? [];
  const values = new Map<string, string>();
  for (const ref of refs) {
    const property = all.find((e) => e.ref === ref);
    const match = property && /^'([^']+)',\$,(.*),[^,]+$/.exec(property.raw);
    if (match) values.set(match[1] ?? '', match[2] ?? '');
  }
  return values;
}

describe('exportação IFC dos reservatórios de catálogo', () => {
  const build = () => {
    let project = createProject('Reservatórios', 'infra');
    const goblet = placeTank(project, 'tramec-taca-sem-agua', 10, 0);
    project = goblet.project;
    const twin = placeTank(project, 'tramec-taca-sem-agua', 10, 10);
    project = twin.project;
    const horizontal = placeTank(project, 'tramec-cilindrico-horizontal', null, 20);
    project = unwrap(
      addTankNozzle(horizontal.project, goblet.elementId, {
        role: 'overflow',
        height: 7.5,
        azimuth: -Math.PI / 2,
        spec,
      }),
    ).project;
    project = unwrap(
      updateTankSettings(project, horizontal.elementId, { shellThickness: 0.00635 }),
    );
    expect(validateProject(project)).toEqual([]);
    return {
      project,
      goblet: goblet.elementId,
      twin: twin.elementId,
      horizontal: horizontal.elementId,
    };
  };

  it('classifica como IfcTank/IfcTankType STORAGE e agrupa ocorrências do mesmo modelo', () => {
    const { project, goblet, twin, horizontal } = build();
    const all = entities(exportIfc(project, { timestamp, tankFamilies: TANK_FAMILIES }));
    const tanks = byType(all, 'IfcTank');
    expect(tanks).toHaveLength(3);
    expect(tanks.every((tank) => tank.raw.endsWith('.STORAGE.'))).toBe(true);

    const types = byType(all, 'IfcTankType');
    expect(types).toHaveLength(2);
    expect(types.every((type) => type.raw.endsWith('.STORAGE.'))).toBe(true);
    const relations = byType(all, 'IfcRelDefinesByType');
    expect(relations).toHaveLength(2);
    const refOf = (id: string): string =>
      tanks.find((tank) => tank.raw.startsWith(`'${toIfcGuid(id)}'`))?.ref ?? '';
    const shared = relations.find((rel) => rel.raw.includes(refOf(goblet)));
    expect(shared?.raw).toContain(`(${refOf(goblet)},${refOf(twin)})`);
    expect(relations.find((rel) => rel.raw.includes(refOf(horizontal)))?.raw).toContain(
      `(${refOf(horizontal)})`,
    );

    // Material do corpo: aço-carbono estrutural, associado às ocorrências e aos tipos —
    // e não o material da tubulação dos bocais.
    const materials = byType(all, 'IfcMaterial');
    expect(materials).toHaveLength(1);
    expect(materials[0]?.raw).toContain('A\\X2\\00E7\\X0\\o-carbono estrutural');
    const association = byType(all, 'IfcRelAssociatesMaterial')[0];
    for (const ref of [...tanks, ...types].map((e) => e.ref)) {
      expect(association?.raw).toContain(ref);
    }
  });

  it('grava o Pset do fabricante com as dimensões do catálogo e as grandezas IFC', () => {
    const { project, goblet, horizontal } = build();
    const text = exportIfc(project, { timestamp, tankFamilies: TANK_FAMILIES });
    const all = entities(text);
    const refOf = (id: string): string =>
      byType(all, 'IfcTank').find((tank) => tank.raw.startsWith(`'${toIfcGuid(id)}'`))?.ref ?? '';

    const pset = propertiesOf(all, 'Pset_TRAMEC_Reservatorio', refOf(goblet));
    expect([...pset.keys()]).toEqual(
      expect.arrayContaining([
        'Manufacturer',
        'Model',
        'ReservoirType',
        'NominalCapacity',
        'TotalHeight',
        'Diameter',
        'ColumnHeight',
        'ConeHeight',
        'SupportHeight',
        'ShellThickness',
        'NumberOfCompartments',
        'BottomType',
        'InstallationType',
        'Material',
        'CatalogReference',
      ]),
    );
    // Linha "10.000 / 8,30 / 1,91 / 4,80" da tabela sem água na coluna.
    expect(pset.get('Manufacturer')).toBe("IFCLABEL('TRAMEC')");
    expect(pset.get('NominalCapacity')).toBe('IFCVOLUMEMEASURE(10.)');
    expect(pset.get('TotalHeight')).toBe('IFCPOSITIVELENGTHMEASURE(8.3)');
    expect(pset.get('Diameter')).toBe('IFCPOSITIVELENGTHMEASURE(1.91)');
    expect(pset.get('ColumnHeight')).toBe('IFCPOSITIVELENGTHMEASURE(4.8)');
    expect(pset.get('NumberOfCompartments')).toBe('IFCINTEGER(1)');
    expect(pset.get('BaseElevation')).toBe('IFCLENGTHMEASURE(100.)');
    expect(pset.get('CatalogReference')).toContain('p. 4');
    // O catálogo não informa a espessura nem os pés deste modelo: propriedades sem valor.
    expect(pset.get('ShellThickness')).toBe('$');
    expect(pset.get('SupportHeight')).toBe('$');

    const other = propertiesOf(all, 'Pset_TRAMEC_Reservatorio', refOf(horizontal));
    expect(other.get('ShellThickness')).toBe('IFCPOSITIVELENGTHMEASURE(0.00635)');
    expect(other.get('Length')).toBe('IFCPOSITIVELENGTHMEASURE(3.6)');
    expect(other.get('ColumnHeight')).toBe('$');

    // Origem de cada parâmetro: catálogo × estimado × usuário.
    const origins = propertiesOf(all, 'HydroBIM_Reservatorio_OrigemDosParametros', refOf(goblet));
    expect(origins.get('Diameter')).toContain('cat');
    expect(origins.get('ColumnHeight')).toContain('cat');
    expect(origins.get('ColumnDiameter')).toContain('estimado');
    expect(origins.get('ShellThickness')).toContain('estimado');
    const custom = propertiesOf(
      all,
      'HydroBIM_Reservatorio_OrigemDosParametros',
      refOf(horizontal),
    );
    expect(custom.get('Diameter')).toContain('usu');
    expect(custom.get('ShellThickness')).toContain('usu');

    // Conjuntos padrão (nomes conferidos no IfcOpenShell para o IFC 4.3).
    const common = propertiesOf(all, 'Pset_TankTypeCommon');
    expect(common.get('TankNominalCapacity')).toBe('IFCVOLUMEMEASURE(10.)');
    expect(common.get('NumberOfSections')).toBe('IFCCOUNTMEASURE(1)');
    expect(text).toContain("IFCPROPERTYENUMERATION('PEnum_TankPatternType'");
    expect(byType(all, 'IfcElementQuantity')).toHaveLength(3);
    expect(
      byType(all, 'IfcQuantityVolume').some((q) => q.raw.startsWith("'NominalCapacity'")),
    ).toBe(true);
    expect([...text].every((character) => character.charCodeAt(0) <= 127)).toBe(true);
  });

  it('exporta cada bocal como IfcDistributionPort com função, sentido e diâmetro', () => {
    const { project, goblet } = build();
    const all = entities(exportIfc(project, { timestamp, tankFamilies: TANK_FAMILIES }));
    const ports = byType(all, 'IfcDistributionPort');
    expect(ports).toHaveLength(7);
    const flow = (label: string): string[] =>
      ports.filter((port) => port.raw.includes(`'${label}'`)).map((port) => port.raw);
    expect(flow('Entrada').every((raw) => raw.includes('.SINK.,.PIPE.,.WATERSUPPLY.'))).toBe(true);
    expect(flow('Extravasor')).toHaveLength(1);
    expect(flow('Extravasor')[0]).toContain('.SOURCE.,.PIPE.,.WATERSUPPLY.');
    expect(byType(all, 'IfcRelNests')).toHaveLength(3);

    const tank = getElement(project, goblet);
    expect(tank?.kind === 'tank' && tank.nozzles).toHaveLength(1);
    const portRef = ports.find((port) => port.raw.includes("'Extravasor'"))?.ref;
    const pipe = propertiesOf(all, 'Pset_DistributionPortTypePipe', portRef);
    expect(pipe.get('NominalDiameter')).toBe('IFCPOSITIVELENGTHMEASURE(0.1)');
    expect(pipe.get('OuterDiameter')).toBe('IFCPOSITIVELENGTHMEASURE(0.118)');
    const nozzle = propertiesOf(all, 'HydroBIM_Bocal', portRef);
    expect(nozzle.get('Function')).toBe("IFCLABEL('Extravasor')");
    expect(nozzle.get('HeightAboveBase')).toBe('IFCLENGTHMEASURE(7.5)');
  });

  it('sem as famílias, exporta o reservatório sem inventar a referência de catálogo', () => {
    const { project } = build();
    const all = entities(exportIfc(project, { timestamp }));
    expect(propertiesOf(all, 'Pset_TRAMEC_Reservatorio').get('CatalogReference')).toBe('$');
    expect(byType(all, 'IfcPropertySet').some((e) => e.raw.includes('OrigemDosParametros'))).toBe(
      false,
    );
  });
});
