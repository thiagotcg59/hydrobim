import {
  TANK_ORIGIN_LABELS,
  TANK_TYPE_LABELS,
  tankBottomType,
  tankGeometricVolume,
  tankInstallationType,
  tankLayout,
  tankParameterOrigins,
  tankTypeOf,
  type Tank,
  type TankFamily,
  type TankOriginKey,
  type TankParameterOrigin,
} from '@hydrobim/core';
import type { IfcPropertySetInfo, IfcValueOrigin } from './types';
import { ownProperty, standardProperty } from './values';

/** "Fabricados em aço carbono estrutural" — material dos reservatórios metálicos de catálogo. */
export const STRUCTURAL_STEEL = 'Aço-carbono estrutural';

const ORIGINS: Record<TankParameterOrigin, IfcValueOrigin> = {
  catalog: 'catalog',
  derived: 'catalog',
  estimated: 'model',
  user: 'user',
};

/** Conjuntos de propriedades e de quantidades da ocorrência de um reservatório de catálogo. */
export function tankOccurrenceSets(
  tank: Tank,
  family: TankFamily | undefined,
): IfcPropertySetInfo[] {
  const layout = tankLayout(tank);
  const type = tankTypeOf(tank);
  const base = tank.placement.position.z;
  const origins = family ? tankParameterOrigins(tank, family) : {};
  const origin = (key: TankOriginKey): IfcValueOrigin => {
    const found = origins[key];
    return found ? ORIGINS[found] : 'model';
  };
  const maker = tank.manufacturing.manufacturer ?? 'HydroBIM';
  const name = `Pset_${maker.replace(/[^A-Za-z0-9]/g, '')}_Reservatorio`;
  const length = 'IfcPositiveLengthMeasure';
  const sets: IfcPropertySetInfo[] = [
    {
      name,
      kind: 'pset',
      standard: false,
      scope: 'occurrence',
      description: null,
      properties: [
        ownProperty(
          name,
          'Manufacturer',
          'Fabricante',
          'IfcLabel',
          tank.manufacturing.manufacturer,
          'catalog',
        ),
        ownProperty(name, 'Model', 'Modelo', 'IfcLabel', tank.manufacturing.model, 'catalog'),
        ownProperty(
          name,
          'ReservoirType',
          'Tipo construtivo',
          'IfcLabel',
          TANK_TYPE_LABELS[type],
          'model',
        ),
        ownProperty(
          name,
          'NominalCapacity',
          'Capacidade nominal',
          'IfcVolumeMeasure',
          tank.nominalCapacity,
          origin('nominalCapacity'),
          { binding: 'Reservatório: capacidade' },
        ),
        ownProperty(name, 'TotalHeight', 'Altura total', length, layout.top, origin('height'), {
          binding: 'Reservatório: altura',
        }),
        ownProperty(name, 'Diameter', 'Diâmetro', length, tank.diameter, origin('diameter'), {
          binding: 'Reservatório: diâmetro',
        }),
        ownProperty(name, 'Length', 'Comprimento', length, tank.length, origin('length'), {
          binding: 'Reservatório: comprimento',
        }),
        ownProperty(
          name,
          'ColumnHeight',
          'Altura da coluna',
          length,
          tank.columnHeight,
          origin('columnHeight'),
          { binding: 'Reservatório: coluna' },
        ),
        ownProperty(
          name,
          'ColumnDiameter',
          'Diâmetro da coluna',
          length,
          tank.columnDiameter,
          origin('columnDiameter'),
          { binding: 'Reservatório: coluna' },
        ),
        ownProperty(
          name,
          'ConeHeight',
          'Altura do cone',
          length,
          tank.coneHeight,
          origin('coneHeight'),
          { binding: 'Reservatório: cone' },
        ),
        ownProperty(
          name,
          'SupportHeight',
          'Altura do apoio',
          'IfcNonNegativeLengthMeasure',
          tank.supportHeight,
          origin('supportHeight'),
          { binding: 'Reservatório: apoio' },
        ),
        // Sem valor quando o usuário não informou: o catálogo não tabula a espessura.
        ownProperty(
          name,
          'ShellThickness',
          'Espessura das chapas',
          length,
          tank.shellThickness,
          'user',
          { binding: 'Reservatório: espessura das chapas' },
        ),
        ownProperty(
          name,
          'NumberOfCompartments',
          'Quantidade de células',
          'IfcInteger',
          tank.compartments ?? 1,
          origin('compartments'),
          { binding: 'Reservatório: células' },
        ),
        ownProperty(name, 'BottomType', 'Tipo de fundo', 'IfcLabel', tankBottomType(type), 'model'),
        ownProperty(
          name,
          'InstallationType',
          'Instalação',
          'IfcLabel',
          tankInstallationType(tank),
          'model',
        ),
        ownProperty(
          name,
          'Material',
          'Material',
          'IfcLabel',
          family?.material ?? STRUCTURAL_STEEL,
          family ? 'catalog' : 'model',
        ),
        ownProperty(
          name,
          'CatalogReference',
          'Referência do catálogo',
          'IfcText',
          family?.source,
          'catalog',
        ),
        ownProperty(name, 'BaseElevation', 'Cota da base', 'IfcLengthMeasure', base, 'geometry', {
          binding: 'Geometria: posição do elemento',
        }),
        ownProperty(
          name,
          'MaxWaterLevelElevation',
          'Cota do nível máximo',
          'IfcLengthMeasure',
          tank.maxWaterLevel === undefined ? null : base + tank.maxWaterLevel,
          'user',
          { binding: 'Reservatório: nível máximo' },
        ),
      ],
    },
    {
      name: 'Pset_TankOccurrence',
      kind: 'pset',
      standard: true,
      scope: 'occurrence',
      description: null,
      properties: [
        standardProperty(
          'Pset_TankOccurrence',
          'TankComposition',
          'Composição',
          'ELEMENT',
          'model',
        ),
        standardProperty(
          'Pset_TankOccurrence',
          'HasLadder',
          'Escada',
          tank.accessories?.ladder ?? false,
          'model',
          { binding: 'Reservatório: acessórios' },
        ),
      ],
    },
  ];
  if (family) {
    const set = 'HydroBIM_Reservatorio_OrigemDosParametros';
    sets.push({
      name: set,
      kind: 'pset',
      standard: false,
      scope: 'occurrence',
      description: null,
      properties: Object.entries(tankParameterOrigins(tank, family))
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, value]) => {
          const property = `${key.charAt(0).toUpperCase()}${key.slice(1)}`;
          return ownProperty(
            set,
            property,
            property,
            'IfcLabel',
            TANK_ORIGIN_LABELS[value],
            'model',
          );
        }),
    });
  }
  const horizontal = type === 'horizontal';
  const qto = 'HydroBIM_Reservatorio_Quantidades';
  const quantity = (name2: string, label: string, ifcType: string, v: number) =>
    ownProperty(qto, name2, label, ifcType, v, 'geometry', { kind: 'quantity' });
  sets.push({
    name: qto,
    kind: 'qto',
    standard: false,
    scope: 'occurrence',
    description: 'Dimensões externas, sem descontar chapas nem borda livre',
    properties: [
      ...(tank.nominalCapacity === undefined
        ? []
        : [
            ownProperty(
              qto,
              'NominalCapacity',
              'Capacidade nominal',
              'IfcQuantityVolume',
              tank.nominalCapacity,
              origin('nominalCapacity'),
              { kind: 'quantity' },
            ),
          ]),
      quantity(
        'GeometricVolume',
        'Volume geométrico',
        'IfcQuantityVolume',
        tankGeometricVolume(tank),
      ),
      quantity('TotalHeight', 'Altura total', 'IfcQuantityLength', layout.top),
      quantity('Diameter', 'Diâmetro', 'IfcQuantityLength', tank.diameter),
      ...(horizontal
        ? [quantity('Length', 'Comprimento', 'IfcQuantityLength', tank.length ?? 0)]
        : []),
      quantity(
        'ProjectedArea',
        'Área em planta',
        'IfcQuantityArea',
        horizontal ? tank.diameter * (tank.length ?? 0) : Math.PI * layout.radius ** 2,
      ),
    ],
  });
  return sets;
}

/** Conjuntos de propriedades do tipo (`IfcTankType`) de um reservatório de catálogo. */
export function tankTypeSets(sample: Tank): IfcPropertySetInfo[] {
  const type = tankTypeOf(sample);
  const layout = tankLayout(sample);
  const horizontal = type === 'horizontal';
  const common = 'Pset_TankTypeCommon';
  const maker = 'Pset_ManufacturerTypeInformation';
  return [
    {
      name: common,
      kind: 'pset',
      standard: true,
      scope: 'type',
      description: null,
      properties: [
        standardProperty(
          common,
          'Reference',
          'Referência do tipo',
          sample.variantId ?? sample.familyId,
          'catalog',
        ),
        standardProperty(
          common,
          'AccessType',
          'Acesso',
          sample.accessories?.manhole ? 'MANHOLE' : 'NONE',
          'model',
        ),
        standardProperty(
          common,
          'NominalLengthOrDiameter',
          'Comprimento ou diâmetro',
          horizontal ? sample.length : sample.diameter,
          'catalog',
        ),
        standardProperty(
          common,
          'NominalWidthOrDiameter',
          'Largura ou diâmetro',
          sample.diameter,
          'catalog',
        ),
        standardProperty(
          common,
          'NominalDepth',
          'Altura',
          horizontal ? sample.diameter : layout.top,
          'catalog',
        ),
        standardProperty(
          common,
          'TankNominalCapacity',
          'Capacidade nominal',
          sample.nominalCapacity,
          'catalog',
        ),
        standardProperty(
          common,
          'PatternType',
          'Forma',
          horizontal ? 'HORIZONTALCYLINDER' : 'VERTICALCYLINDER',
          'model',
        ),
        standardProperty(
          common,
          'EndShapeType',
          'Forma dos tampos',
          horizontal
            ? 'CONVEXCONVEX'
            : layout.coneHeight > 0 || type === 'australian'
              ? 'OTHER'
              : 'FLATFLAT',
          'model',
        ),
        standardProperty(
          common,
          'NumberOfSections',
          'Número de seções',
          sample.compartments ?? 1,
          'model',
        ),
      ],
    },
    {
      name: maker,
      kind: 'pset',
      standard: true,
      scope: 'type',
      description: null,
      properties: [
        standardProperty(
          maker,
          'Manufacturer',
          'Fabricante',
          sample.manufacturing.manufacturer,
          'catalog',
        ),
        standardProperty(maker, 'ModelLabel', 'Modelo', sample.manufacturing.model, 'catalog'),
        standardProperty(
          maker,
          'ModelReference',
          'Referência do modelo',
          sample.variantId,
          'catalog',
        ),
        standardProperty(
          maker,
          'AssemblyPlace',
          'Local de montagem',
          type === 'fieldErected' ? 'SITE' : 'FACTORY',
          'model',
        ),
      ],
    },
  ];
}
