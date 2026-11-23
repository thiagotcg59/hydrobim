import {
  FILE_DESCRIPTION,
  FILE_NAME,
  IFCFEATUREELEMENTSUBTRACTION,
  IFCMAPCONVERSION,
  IFCPORT,
  IFCPRODUCT,
  IFCPROJECT,
  IFCRELAGGREGATES,
  IFCRELASSOCIATESCLASSIFICATION,
  IFCRELASSOCIATESMATERIAL,
  IFCRELCONNECTSPORTTOELEMENT,
  IFCRELCONTAINEDINSPATIALSTRUCTURE,
  IFCRELDEFINESBYPROPERTIES,
  IFCRELDEFINESBYTYPE,
  IFCRELNESTS,
  IFCSPACE,
  IFCSPATIALELEMENT,
  IFCSPATIALSTRUCTUREELEMENT,
  type FlatMesh,
  type IfcAPI,
} from 'web-ifc';
import { sniffIfc, type IfcSniff } from './header';
import {
  isRaw,
  numberOf,
  refOf,
  refsOf,
  scalarOf,
  textOf,
  valueTypeOf,
  type LineReader,
  type Raw,
  type Scalar,
} from './raw';
import {
  IfcReadError,
  type IfcBounds,
  type IfcClassificationInfo,
  type IfcGeometryStatus,
  type IfcGeoreferenceInfo,
  type IfcMaterialInfo,
  type IfcMeshGeometry,
  type IfcMeshPart,
  type IfcMeshSet,
  type IfcModelSummary,
  type IfcObjectProperties,
  type IfcObjectSummary,
  type IfcPropertyEntry,
  type IfcPropertyGroup,
  type IfcPropertyScope,
  type IfcReadProgress,
  type IfcReportItem,
  type IfcSpatialNode,
  type IfcTypeInfo,
  type IfcUnitInfo,
} from './types';
import { describeUnit, QUANTITY_UNIT_TYPES, unitTypeOfMeasure } from './units';

/**
 * Leitura de um arquivo IFC com o web-ifc. O chamador entrega a instância de `IfcAPI` já
 * iniciada (no navegador, dentro de um Web Worker; nos testes, no Node), de modo que este
 * módulo não conhece o ambiente.
 *
 * Convenções de saída: metros e Z para cima, no referencial do arquivo — sem recentralizar.
 * O web-ifc entrega metros e Y para cima; a troca de eixos é feita aqui, uma única vez, na
 * matriz de cada peça.
 */

export interface IfcReadOptions {
  readonly onProgress?: (progress: IfcReadProgress) => void;
  /** Consultado durante a geração da geometria; `true` interrompe a leitura. */
  readonly isCancelled?: () => boolean;
}

export interface IfcReadResult {
  readonly summary: IfcModelSummary;
  readonly meshes: IfcMeshSet;
}

const plural = (count: number, one: string, many: string): string =>
  `${count.toLocaleString('pt-BR')} ${count === 1 ? one : many}`;

/** Y para cima (web-ifc) → Z para cima: (x, y, z) ↦ (x, −z, y), aplicado a cada coluna. */
function toZUp(matrix: ArrayLike<number>): number[] {
  const out = new Array<number>(16);
  for (let column = 0; column < 4; column += 1) {
    const base = column * 4;
    out[base] = matrix[base] ?? 0;
    out[base + 1] = -(matrix[base + 2] ?? 0);
    out[base + 2] = matrix[base + 1] ?? 0;
    out[base + 3] = matrix[base + 3] ?? 0;
  }
  return out;
}

class Bounds {
  min: [number, number, number] = [Infinity, Infinity, Infinity];
  max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  add(x: number, y: number, z: number): void {
    if (x < this.min[0]) this.min[0] = x;
    if (y < this.min[1]) this.min[1] = y;
    if (z < this.min[2]) this.min[2] = z;
    if (x > this.max[0]) this.max[0] = x;
    if (y > this.max[1]) this.max[1] = y;
    if (z > this.max[2]) this.max[2] = z;
  }
  merge(other: IfcBounds): void {
    this.add(other[0], other[1], other[2]);
    this.add(other[3], other[4], other[5]);
  }
  value(): IfcBounds | null {
    return Number.isFinite(this.min[0]) ? [...this.min, ...this.max] : null;
  }
}

interface PropertyIndex {
  readonly sets: Map<number, number[]>;
  readonly materials: Map<number, number>;
  readonly classifications: Map<number, number[]>;
  readonly ports: Map<number, number>;
}

export class IfcSession {
  private readonly lineCache = new Map<number, Raw | null>();
  private readonly entityCache = new Map<number, string>();
  private readonly nameCache = new Map<string, string>();
  private readonly parent = new Map<number, number>();
  private readonly typeOf = new Map<number, number>();
  private readonly nodeIds = new Set<number>();
  private readonly unitsByType = new Map<string, IfcUnitInfo>();
  private structureRead = false;
  private propertyIndex: PropertyIndex | null = null;
  private closed = false;

  constructor(
    private readonly api: IfcAPI,
    private readonly modelId: number,
    readonly sniff: IfcSniff,
  ) {}

  // --- acesso às linhas ---------------------------------------------------------------

  private readonly line: LineReader = (expressId) => {
    if (expressId <= 0) return null;
    const cached = this.lineCache.get(expressId);
    if (cached !== undefined) return cached;
    let line: Raw | null;
    try {
      const raw: unknown = this.api.GetLine(this.modelId, expressId, false);
      line = isRaw(raw) ? raw : null;
    } catch {
      line = null;
    }
    this.lineCache.set(expressId, line);
    return line;
  };

  private readonly entityOf = (expressId: number): string => {
    const cached = this.entityCache.get(expressId);
    if (cached !== undefined) return cached;
    let name = '';
    try {
      const code: unknown = this.api.GetLineType(this.modelId, expressId);
      if (typeof code === 'number') name = this.api.GetNameFromTypeCode(code);
    } catch {
      name = '';
    }
    this.entityCache.set(expressId, name);
    return name;
  };

  /** `IFCLENGTHMEASURE` → `IfcLengthMeasure`, pela tabela do próprio leitor. */
  private properName(upper: string): string {
    const cached = this.nameCache.get(upper);
    if (cached !== undefined) return cached;
    let name = upper;
    try {
      const resolved = this.api.GetNameFromTypeCode(this.api.GetTypeCodeFromName(upper));
      if (typeof resolved === 'string' && resolved !== '') name = resolved;
    } catch {
      name = upper;
    }
    this.nameCache.set(upper, name);
    return name;
  }

  private idsOf(type: number): number[] {
    try {
      const vector = this.api.GetLineIDsWithType(this.modelId, type, true);
      const ids: number[] = [];
      for (let index = 0; index < vector.size(); index += 1) ids.push(vector.get(index));
      return ids;
    } catch {
      // Entidade inexistente no esquema do arquivo (ex.: IfcMapConversion em IFC2X3).
      return [];
    }
  }

  // --- estrutura ----------------------------------------------------------------------

  private readUnits(): IfcUnitInfo[] {
    const project = this.line(this.idsOf(IFCPROJECT)[0] ?? -1);
    const assignment = project ? this.line(refOf(project.UnitsInContext) ?? -1) : null;
    const units: IfcUnitInfo[] = [];
    for (const unitId of assignment ? refsOf(assignment.Units) : []) {
      const unit = describeUnit(this.line, unitId, this.entityOf);
      if (!unit) continue;
      units.push(unit);
      if (!this.unitsByType.has(unit.type)) this.unitsByType.set(unit.type, unit);
    }
    return units;
  }

  private readRelations(): { children: Map<number, number[]> } {
    const children = new Map<number, number[]>();
    for (const type of [IFCRELAGGREGATES, IFCRELNESTS]) {
      for (const relId of this.idsOf(type)) {
        const rel = this.line(relId);
        const owner = rel ? refOf(rel.RelatingObject) : null;
        if (!rel || owner === null) continue;
        for (const child of refsOf(rel.RelatedObjects)) {
          if (!this.parent.has(child)) this.parent.set(child, owner);
          const list = children.get(owner);
          if (list) list.push(child);
          else children.set(owner, [child]);
        }
      }
    }
    // A contenção espacial prevalece sobre a decomposição.
    for (const relId of this.idsOf(IFCRELCONTAINEDINSPATIALSTRUCTURE)) {
      const rel = this.line(relId);
      const owner = rel ? refOf(rel.RelatingStructure) : null;
      if (!rel || owner === null) continue;
      for (const child of refsOf(rel.RelatedElements)) this.parent.set(child, owner);
    }
    for (const relId of this.idsOf(IFCRELDEFINESBYTYPE)) {
      const rel = this.line(relId);
      const type = rel ? refOf(rel.RelatingType) : null;
      if (!rel || type === null) continue;
      for (const object of refsOf(rel.RelatedObjects)) this.typeOf.set(object, type);
    }
    return { children };
  }

  /** Nó da estrutura espacial que contém o objeto, subindo pela decomposição. */
  private containerOf(expressId: number): number | null {
    let current = this.parent.get(expressId);
    for (let guard = 0; current !== undefined && guard < 64; guard += 1) {
      if (this.nodeIds.has(current)) return current;
      current = this.parent.get(current);
    }
    return null;
  }

  private storeyNameOf(expressId: number): string | null {
    let current: number | undefined = this.containerOf(expressId) ?? undefined;
    for (let guard = 0; current !== undefined && guard < 64; guard += 1) {
      if (this.entityOf(current) === 'IfcBuildingStorey') {
        return textOf(this.line(current)?.Name);
      }
      current = this.parent.get(current);
    }
    return null;
  }

  private representationsOf(line: Raw): string[] {
    const shape = this.line(refOf(line.Representation) ?? -1);
    if (!shape) return [];
    return refsOf(shape.Representations).map((id) => {
      const representation = this.line(id);
      const identifier = textOf(representation?.RepresentationIdentifier) ?? '—';
      const type = textOf(representation?.RepresentationType) ?? '—';
      return `${identifier} · ${type}`;
    });
  }

  private readGeoreference(): IfcGeoreferenceInfo | null {
    const conversion = this.line(this.idsOf(IFCMAPCONVERSION)[0] ?? -1);
    if (!conversion) return null;
    const crs = this.line(refOf(conversion.TargetCRS) ?? -1);
    return {
      crsName: textOf(crs?.Name),
      crsDescription: textOf(crs?.Description),
      geodeticDatum: textOf(crs?.GeodeticDatum),
      verticalDatum: textOf(crs?.VerticalDatum),
      mapProjection: textOf(crs?.MapProjection),
      mapZone: textOf(crs?.MapZone),
      eastings: numberOf(conversion.Eastings) ?? 0,
      northings: numberOf(conversion.Northings) ?? 0,
      orthogonalHeight: numberOf(conversion.OrthogonalHeight) ?? 0,
      xAxisAbscissa: numberOf(conversion.XAxisAbscissa),
      xAxisOrdinate: numberOf(conversion.XAxisOrdinate),
      scale: numberOf(conversion.Scale),
    };
  }

  private headerText(type: number, index: number): string | null {
    try {
      const header: unknown = this.api.GetHeaderLine(this.modelId, type);
      if (!isRaw(header) || !Array.isArray(header.arguments)) return null;
      const argument: unknown = header.arguments[index];
      if (Array.isArray(argument)) {
        const parts = argument.map((item) => textOf(item)).filter((item) => item !== null);
        return parts.length > 0 ? parts.join('; ') : null;
      }
      return textOf(argument);
    } catch {
      return null;
    }
  }

  // --- leitura completa ---------------------------------------------------------------

  read(options: IfcReadOptions = {}): IfcReadResult {
    const progress = options.onProgress ?? (() => undefined);
    progress({ stage: 'structure', fraction: null });

    const units = this.readUnits();
    const length = this.unitsByType.get('LENGTHUNIT');
    const lengthScale = length?.toSi ?? 1;

    const productIds = this.idsOf(IFCPRODUCT);
    const spatialIds = new Set([
      ...this.idsOf(IFCSPATIALSTRUCTUREELEMENT),
      ...this.idsOf(IFCSPATIALELEMENT),
    ]);
    const openingIds = new Set(this.idsOf(IFCFEATUREELEMENTSUBTRACTION));
    const portIds = new Set(this.idsOf(IFCPORT));
    // Ambientes são objetos (têm geometria e propriedades); os demais são nós da árvore.
    for (const id of spatialIds) if (this.entityOf(id) !== 'IfcSpace') this.nodeIds.add(id);
    const { children } = this.readRelations();
    this.structureRead = true;

    // --- geometria -------------------------------------------------------------------
    progress({ stage: 'geometry', fraction: 0 });
    const geometries = new Map<number, IfcMeshGeometry | null>();
    const failedObjects = new Set<number>();
    const parts = new Map<number, IfcMeshPart[]>();
    const boundsOf = new Map<number, Bounds>();
    const trianglesOf = new Map<number, number>();

    const geometryOf = (geometryId: number): IfcMeshGeometry | null => {
      const cached = geometries.get(geometryId);
      if (cached !== undefined) return cached;
      const geometry = this.api.GetGeometry(this.modelId, geometryId);
      let mesh: IfcMeshGeometry | null = null;
      try {
        const vertices = this.api.GetVertexArray(
          geometry.GetVertexData(),
          geometry.GetVertexDataSize(),
        );
        const indices = this.api.GetIndexArray(
          geometry.GetIndexData(),
          geometry.GetIndexDataSize(),
        );
        const count = Math.floor(vertices.length / 6);
        if (count > 0 && indices.length >= 3) {
          // O web-ifc intercala posição e normal (6 números por vértice).
          const positions = new Float32Array(count * 3);
          const normals = new Float32Array(count * 3);
          for (let v = 0; v < count; v += 1) {
            positions[v * 3] = vertices[v * 6] ?? 0;
            positions[v * 3 + 1] = vertices[v * 6 + 1] ?? 0;
            positions[v * 3 + 2] = vertices[v * 6 + 2] ?? 0;
            normals[v * 3] = vertices[v * 6 + 3] ?? 0;
            normals[v * 3 + 1] = vertices[v * 6 + 4] ?? 0;
            normals[v * 3 + 2] = vertices[v * 6 + 5] ?? 0;
          }
          mesh = { id: geometryId, positions, normals, indices: new Uint32Array(indices) };
        }
      } finally {
        geometry.delete();
      }
      geometries.set(geometryId, mesh);
      return mesh;
    };

    const onMesh = (flat: FlatMesh, index: number, total: number): void => {
      if (options.isCancelled?.()) {
        throw new IfcReadError('IFC_CANCELLED', 'Importação cancelada.');
      }
      const expressId = flat.expressID;
      const list = parts.get(expressId) ?? [];
      const bounds = boundsOf.get(expressId) ?? new Bounds();
      let triangles = trianglesOf.get(expressId) ?? 0;
      for (let i = 0; i < flat.geometries.size(); i += 1) {
        const placed = flat.geometries.get(i);
        let geometry: IfcMeshGeometry | null;
        try {
          geometry = geometryOf(placed.geometryExpressID);
        } catch {
          failedObjects.add(expressId);
          continue;
        }
        if (!geometry) continue;
        const m = toZUp(placed.flatTransformation);
        const p = geometry.positions;
        for (let v = 0; v < p.length; v += 3) {
          const x = p[v] ?? 0;
          const y = p[v + 1] ?? 0;
          const z = p[v + 2] ?? 0;
          bounds.add(
            (m[0] ?? 0) * x + (m[4] ?? 0) * y + (m[8] ?? 0) * z + (m[12] ?? 0),
            (m[1] ?? 0) * x + (m[5] ?? 0) * y + (m[9] ?? 0) * z + (m[13] ?? 0),
            (m[2] ?? 0) * x + (m[6] ?? 0) * y + (m[10] ?? 0) * z + (m[14] ?? 0),
          );
        }
        triangles += geometry.indices.length / 3;
        list.push({
          geometryId: geometry.id,
          matrix: m,
          color: [placed.color.x, placed.color.y, placed.color.z, placed.color.w],
        });
      }
      if (list.length > 0) {
        parts.set(expressId, list);
        boundsOf.set(expressId, bounds);
        trianglesOf.set(expressId, triangles);
      }
      if (total > 0 && index % 25 === 0) {
        progress({ stage: 'geometry', fraction: Math.min(1, (index + 1) / total) });
      }
    };
    this.api.StreamAllMeshes(this.modelId, onMesh);
    // O fluxo geral do leitor deixa os ambientes de fora; eles são pedidos à parte.
    if (this.idsOf(IFCSPACE).length > 0) {
      this.api.StreamAllMeshesWithTypes(this.modelId, [IFCSPACE], onMesh);
    }

    // --- objetos ---------------------------------------------------------------------
    progress({ stage: 'finishing', fraction: null });
    const objects: IfcObjectSummary[] = [];
    const total = new Bounds();
    let triangleTotal = 0;
    const byContainer = new Map<number, number[]>();
    const outside: number[] = [];
    for (const expressId of productIds) {
      if (openingIds.has(expressId) || portIds.has(expressId)) continue;
      const hasMesh = parts.has(expressId);
      // Terreno, edifício e pavimentos só viram objeto quando trazem geometria própria.
      if (this.nodeIds.has(expressId) && !hasMesh) continue;
      const line = this.line(expressId);
      if (!line) continue;
      const representations = this.representationsOf(line);
      const geometry: IfcGeometryStatus = hasMesh
        ? 'ok'
        : failedObjects.has(expressId)
          ? 'failed'
          : refOf(line.Representation) !== null
            ? 'unsupported'
            : 'none';
      const bounds = boundsOf.get(expressId)?.value() ?? null;
      if (bounds) total.merge(bounds);
      const triangles = trianglesOf.get(expressId) ?? 0;
      triangleTotal += triangles;
      const containerId = this.nodeIds.has(expressId) ? expressId : this.containerOf(expressId);
      if (containerId === null) outside.push(expressId);
      else {
        const list = byContainer.get(containerId);
        if (list) list.push(expressId);
        else byContainer.set(containerId, [expressId]);
      }
      const typeId = this.typeOf.get(expressId);
      objects.push({
        expressId,
        globalId: textOf(line.GlobalId) ?? '',
        entity: this.entityOf(expressId),
        predefinedType: textOf(line.PredefinedType),
        name: textOf(line.Name),
        objectType: textOf(line.ObjectType),
        tag: textOf(line.Tag),
        containerId,
        storeyName: this.storeyNameOf(expressId),
        typeName: typeId === undefined ? null : textOf(this.line(typeId)?.Name),
        geometry,
        representations,
        bounds,
        triangles,
      });
    }

    // --- árvore espacial ---------------------------------------------------------------
    const visited = new Set<number>();
    const nodeOf = (expressId: number): IfcSpatialNode => {
      visited.add(expressId);
      const line = this.line(expressId);
      const elevation = numberOf(line?.Elevation);
      return {
        expressId,
        entity: this.entityOf(expressId),
        name: textOf(line?.Name),
        longName: textOf(line?.LongName),
        elevation: elevation === null ? null : elevation * lengthScale,
        children: (children.get(expressId) ?? [])
          .filter((child) => this.nodeIds.has(child) && !visited.has(child))
          .map(nodeOf),
        objectIds: byContainer.get(expressId) ?? [],
      };
    };
    const projectId = this.idsOf(IFCPROJECT)[0];
    const projectLine = projectId === undefined ? null : this.line(projectId);
    const rootChildren =
      projectId === undefined
        ? []
        : (children.get(projectId) ?? []).filter((child) => this.nodeIds.has(child)).map(nodeOf);
    // Nós que o arquivo não liga ao projeto continuam à mostra, na raiz.
    const orphans = [...this.nodeIds]
      .filter((id) => !visited.has(id) && !this.nodeIds.has(this.parent.get(id) ?? -1))
      .map(nodeOf);
    const spatial: IfcSpatialNode = {
      expressId: projectId ?? 0,
      entity: 'IfcProject',
      name: textOf(projectLine?.Name),
      longName: textOf(projectLine?.LongName),
      elevation: null,
      children: [...rootChildren, ...orphans],
      objectIds: outside,
    };

    // --- relatório -------------------------------------------------------------------
    const georeference = this.readGeoreference();
    const report: IfcReportItem[] = [];
    const idsWith = (status: IfcGeometryStatus): number[] =>
      objects.filter((object) => object.geometry === status).map((object) => object.expressId);
    const none = idsWith('none');
    if (none.length > 0) {
      report.push({
        code: 'NO_GEOMETRY',
        severity: 'warning',
        message: `${plural(none.length, 'objeto não tem', 'objetos não têm')} representação geométrica no arquivo. Podem ser importados (árvore e propriedades), mas nada é desenhado no lugar deles.`,
        expressIds: none,
      });
    }
    const unsupported = idsWith('unsupported');
    if (unsupported.length > 0) {
      const kinds = [
        ...new Set(
          objects
            .filter((object) => object.geometry === 'unsupported')
            .flatMap((object) => object.representations),
        ),
      ].slice(0, 6);
      report.push({
        code: 'UNSUPPORTED_REPRESENTATION',
        severity: 'warning',
        message: `${plural(unsupported.length, 'objeto tem', 'objetos têm')} representação que o leitor não converte em malha (${kinds.join('; ') || 'tipo não declarado'}). Entram sem geometria; nenhuma forma substituta é desenhada.`,
        expressIds: unsupported,
      });
    }
    const failed = idsWith('failed');
    if (failed.length > 0) {
      report.push({
        code: 'GEOMETRY_FAILED',
        severity: 'warning',
        message: `O leitor falhou ao gerar a geometria de ${plural(failed.length, 'objeto', 'objetos')}. Entram sem geometria.`,
        expressIds: failed,
      });
    }
    if (openingIds.size > 0) {
      report.push({
        code: 'OPENINGS',
        severity: 'info',
        message: `${plural(openingIds.size, 'vão (IfcOpeningElement e similares) foi aplicado', 'vãos (IfcOpeningElement e similares) foram aplicados')} como recorte nos elementos hospedeiros; vãos não são objetos importáveis.`,
        expressIds: [...openingIds],
      });
    }
    if (portIds.size > 0) {
      report.push({
        code: 'PORTS',
        severity: 'info',
        message: `${plural(portIds.size, 'porta IFC foi lida', 'portas IFC foram lidas')} só como informação: portas de arquivos importados não criam conexões hidráulicas no HydroBIM.`,
        expressIds: [...portIds],
      });
    }
    if (outside.length > 0) {
      report.push({
        code: 'NO_STRUCTURE',
        severity: 'info',
        message: `${plural(outside.length, 'objeto está', 'objetos estão')} fora da estrutura espacial do arquivo (sem pavimento).`,
        expressIds: outside,
      });
    }
    if (georeference) {
      report.push({
        code: 'GEOREFERENCE',
        severity: 'info',
        message: `O arquivo declara georreferência (${georeference.crsName ?? 'sistema sem nome'}). Ela é mostrada na prévia, mas não é aplicada sozinha: o posicionamento é o que for confirmado na importação.`,
        expressIds: [],
      });
    }

    const meshes: IfcMeshSet = {
      geometries: [...geometries.values()].filter((geometry) => geometry !== null),
      objects: [...parts.entries()].map(([expressId, list]) => ({ expressId, parts: list })),
    };
    const summary: IfcModelSummary = {
      header: {
        schema: this.sniff.schema,
        family: this.sniff.family,
        fileName: this.headerText(FILE_NAME, 0),
        timestamp: this.headerText(FILE_NAME, 1),
        application: this.headerText(FILE_NAME, 5),
        description: this.headerText(FILE_DESCRIPTION, 0),
      },
      projectName: textOf(projectLine?.Name),
      units,
      lengthUnit: {
        label: length?.label ?? 'não declarada',
        symbol: length?.symbol ?? '',
        scale: lengthScale,
      },
      georeference,
      spatial,
      objects,
      report,
      bounds: total.value(),
      triangles: triangleTotal,
      productCount: productIds.length,
    };
    return { summary, meshes };
  }

  // --- propriedades (sob demanda) --------------------------------------------------------

  private index(): PropertyIndex {
    if (this.propertyIndex) return this.propertyIndex;
    const sets = new Map<number, number[]>();
    const classifications = new Map<number, number[]>();
    const push = (map: Map<number, number[]>, key: number, values: readonly number[]): void => {
      const list = map.get(key);
      if (list) list.push(...values);
      else map.set(key, [...values]);
    };
    for (const relId of this.idsOf(IFCRELDEFINESBYPROPERTIES)) {
      const rel = this.line(relId);
      if (!rel) continue;
      const definitions = refsOf(rel.RelatingPropertyDefinition);
      for (const object of refsOf(rel.RelatedObjects)) push(sets, object, definitions);
    }
    const materials = new Map<number, number>();
    for (const relId of this.idsOf(IFCRELASSOCIATESMATERIAL)) {
      const rel = this.line(relId);
      const material = rel ? refOf(rel.RelatingMaterial) : null;
      if (!rel || material === null) continue;
      for (const object of refsOf(rel.RelatedObjects)) materials.set(object, material);
    }
    for (const relId of this.idsOf(IFCRELASSOCIATESCLASSIFICATION)) {
      const rel = this.line(relId);
      if (!rel) continue;
      const references = refsOf(rel.RelatingClassification);
      for (const object of refsOf(rel.RelatedObjects)) push(classifications, object, references);
    }
    const ports = new Map<number, number>();
    const portIds = new Set(this.idsOf(IFCPORT));
    const count = (owner: number | null, amount: number): void => {
      if (owner !== null && amount > 0) ports.set(owner, (ports.get(owner) ?? 0) + amount);
    };
    for (const relId of this.idsOf(IFCRELNESTS)) {
      const rel = this.line(relId);
      if (!rel) continue;
      count(
        refOf(rel.RelatingObject),
        refsOf(rel.RelatedObjects).filter((id) => portIds.has(id)).length,
      );
    }
    for (const relId of this.idsOf(IFCRELCONNECTSPORTTOELEMENT)) {
      const rel = this.line(relId);
      if (rel) count(refOf(rel.RelatedElement), 1);
    }
    this.propertyIndex = { sets, materials, classifications, ports };
    return this.propertyIndex;
  }

  private unitOf(
    explicit: unknown,
    unitType: string | null,
  ): Pick<IfcPropertyEntry, 'unit' | 'unitSource'> {
    const explicitId = refOf(explicit);
    if (explicitId !== null) {
      const unit = describeUnit(this.line, explicitId, this.entityOf);
      if (unit) return { unit: unit.symbol, unitSource: 'property' };
    }
    const fromFile = unitType ? this.unitsByType.get(unitType) : undefined;
    return fromFile
      ? { unit: fromFile.symbol, unitSource: 'file' }
      : { unit: null, unitSource: null };
  }

  private typed(value: unknown): { value: Scalar | null; valueType: string | null } {
    const upper = valueTypeOf(value);
    return { value: scalarOf(value), valueType: upper ? this.properName(upper) : null };
  }

  private propertyEntry(expressId: number): IfcPropertyEntry | null {
    const line = this.line(expressId);
    if (!line) return null;
    const entity = this.entityOf(expressId);
    const base = {
      name: textOf(line.Name) ?? '(sem nome)',
      description: textOf(line.Description),
      values: null,
      lower: null,
      upper: null,
    };
    if (entity === 'IfcPropertySingleValue') {
      const { value, valueType } = this.typed(line.NominalValue);
      return {
        ...base,
        kind: 'single',
        value,
        valueType,
        ...this.unitOf(line.Unit, valueType ? unitTypeOfMeasure(valueType) : null),
      };
    }
    if (entity === 'IfcPropertyEnumeratedValue' || entity === 'IfcPropertyListValue') {
      const source = entity === 'IfcPropertyListValue' ? line.ListValues : line.EnumerationValues;
      const items = Array.isArray(source) ? source : [];
      const first = this.typed(items[0]);
      return {
        ...base,
        kind: entity === 'IfcPropertyListValue' ? 'list' : 'enumerated',
        value: null,
        values: items.map((item) => scalarOf(item)).filter((item) => item !== null),
        valueType: first.valueType,
        ...this.unitOf(line.Unit, first.valueType ? unitTypeOfMeasure(first.valueType) : null),
      };
    }
    if (entity === 'IfcPropertyBoundedValue') {
      const lower = this.typed(line.LowerBoundValue);
      const upper = this.typed(line.UpperBoundValue);
      const point = this.typed(line.SetPointValue);
      const valueType = lower.valueType ?? upper.valueType ?? point.valueType;
      const bound = (value: Scalar | null): number | string | null =>
        typeof value === 'boolean' ? String(value) : value;
      return {
        ...base,
        kind: 'bounded',
        value: point.value,
        lower: bound(lower.value),
        upper: bound(upper.value),
        valueType,
        ...this.unitOf(line.Unit, valueType ? unitTypeOfMeasure(valueType) : null),
      };
    }
    if (entity.startsWith('IfcQuantity')) {
      const key = Object.keys(line).find((name) => name.endsWith('Value'));
      const { value, valueType } = this.typed(key ? line[key] : null);
      return {
        ...base,
        kind: 'quantity',
        value,
        valueType: valueType ?? entity,
        ...this.unitOf(line.Unit, QUANTITY_UNIT_TYPES[entity] ?? null),
      };
    }
    // Tabelas, referências e propriedades complexas: listadas, sem leitura do conteúdo.
    return {
      ...base,
      kind: 'unsupported',
      value: null,
      valueType: entity,
      unit: null,
      unitSource: null,
    };
  }

  private propertyGroup(expressId: number, scope: IfcPropertyScope): IfcPropertyGroup | null {
    const line = this.line(expressId);
    if (!line) return null;
    const entity = this.entityOf(expressId);
    const name = textOf(line.Name) ?? entity;
    if (entity === 'IfcPropertySet' || entity === 'IfcElementQuantity') {
      const members = entity === 'IfcPropertySet' ? line.HasProperties : line.Quantities;
      return {
        expressId,
        name,
        kind: entity === 'IfcPropertySet' ? 'properties' : 'quantities',
        scope,
        properties: refsOf(members)
          .map((id) => this.propertyEntry(id))
          .filter((entry) => entry !== null),
      };
    }
    // Conjuntos predefinidos (ex.: IfcDoorLiningProperties): os atributos são as propriedades.
    const skipped = new Set([
      'expressID',
      'type',
      'GlobalId',
      'OwnerHistory',
      'Name',
      'Description',
    ]);
    const properties: IfcPropertyEntry[] = [];
    for (const [key, raw] of Object.entries(line)) {
      if (skipped.has(key) || raw === null || refOf(raw) !== null || Array.isArray(raw)) continue;
      const { value, valueType } = this.typed(raw);
      if (value === null) continue;
      properties.push({
        name: key,
        description: null,
        kind: 'single',
        value,
        valueType,
        values: null,
        lower: null,
        upper: null,
        ...this.unitOf(null, valueType ? unitTypeOfMeasure(valueType) : null),
      });
    }
    return { expressId, name, kind: 'properties', scope, properties };
  }

  private materialsOf(materialId: number, scope: IfcPropertyScope): IfcMaterialInfo[] {
    const line = this.line(materialId);
    if (!line) return [];
    const entity = this.entityOf(materialId);
    const lengthSymbol = this.unitsByType.get('LENGTHUNIT')?.symbol ?? null;
    const nameOf = (id: number | null): string =>
      (id === null ? null : textOf(this.line(id)?.Name)) ?? '(material sem nome)';
    const plain = (
      role: IfcMaterialInfo['role'],
      name: string,
      setName: string | null,
    ): IfcMaterialInfo => ({
      name,
      role,
      setName,
      thickness: null,
      thicknessUnit: null,
      category: null,
      scope,
    });
    switch (entity) {
      case 'IfcMaterial':
        return [
          { ...plain('material', nameOf(materialId), null), category: textOf(line.Category) },
        ];
      case 'IfcMaterialLayerSetUsage':
        return this.materialsOf(refOf(line.ForLayerSet) ?? -1, scope);
      case 'IfcMaterialProfileSetUsage':
      case 'IfcMaterialProfileSetUsageTapering':
        return this.materialsOf(refOf(line.ForProfileSet) ?? -1, scope);
      case 'IfcMaterialLayerSet':
        return refsOf(line.MaterialLayers).flatMap((id) =>
          this.materialsOf(id, scope).map((item) => ({
            ...item,
            setName: textOf(line.LayerSetName),
          })),
        );
      case 'IfcMaterialLayer':
      case 'IfcMaterialLayerWithOffsets':
        return [
          {
            ...plain('layer', nameOf(refOf(line.Material)), null),
            thickness: numberOf(line.LayerThickness),
            thicknessUnit: lengthSymbol,
            category: textOf(line.Category),
          },
        ];
      case 'IfcMaterialList':
        return refsOf(line.Materials).map((id) => plain('list', nameOf(id), null));
      case 'IfcMaterialConstituentSet':
        return refsOf(line.MaterialConstituents).map((id) => {
          const constituent = this.line(id);
          return {
            ...plain('constituent', nameOf(refOf(constituent?.Material)), textOf(line.Name)),
            category: textOf(constituent?.Category) ?? textOf(constituent?.Name),
          };
        });
      case 'IfcMaterialConstituent':
        return [plain('constituent', nameOf(refOf(line.Material)), null)];
      case 'IfcMaterialProfileSet':
        return refsOf(line.MaterialProfiles).map((id) => {
          const profile = this.line(id);
          return {
            ...plain('profile', nameOf(refOf(profile?.Material)), textOf(line.Name)),
            category: textOf(profile?.Name),
          };
        });
      default:
        return [plain('unsupported', entity, null)];
    }
  }

  private classificationOf(referenceId: number, scope: IfcPropertyScope): IfcClassificationInfo {
    const line = this.line(referenceId);
    const entity = this.entityOf(referenceId);
    if (entity === 'IfcClassification') {
      return {
        system: textOf(line?.Name),
        edition: textOf(line?.Edition),
        identification: null,
        name: null,
        location: textOf(line?.Location),
        scope,
      };
    }
    const system = this.line(refOf(line?.ReferencedSource) ?? -1);
    return {
      system: textOf(system?.Name),
      edition: textOf(system?.Edition),
      // IFC4 em diante: `Identification`; IFC2X3: `ItemReference`.
      identification: textOf(line?.Identification) ?? textOf(line?.ItemReference),
      name: textOf(line?.Name),
      location: textOf(line?.Location),
      scope,
    };
  }

  /** Propriedades de um objeto, lidas da fonte no momento da consulta. */
  properties(expressId: number): IfcObjectProperties | null {
    if (this.closed) return null;
    if (!this.structureRead) {
      this.readUnits();
      for (const id of [
        ...this.idsOf(IFCSPATIALSTRUCTUREELEMENT),
        ...this.idsOf(IFCSPATIALELEMENT),
      ]) {
        if (this.entityOf(id) !== 'IfcSpace') this.nodeIds.add(id);
      }
      this.readRelations();
      this.structureRead = true;
    }
    const line = this.line(expressId);
    if (!line || textOf(line.GlobalId) === null) return null;
    const index = this.index();
    const typeId = this.typeOf.get(expressId) ?? null;
    const typeLine = typeId === null ? null : this.line(typeId);
    const type: IfcTypeInfo | null =
      typeId === null || !typeLine
        ? null
        : {
            expressId: typeId,
            globalId: textOf(typeLine.GlobalId),
            entity: this.entityOf(typeId),
            name: textOf(typeLine.Name),
            predefinedType: textOf(typeLine.PredefinedType),
          };

    const groups: IfcPropertyGroup[] = [];
    for (const id of index.sets.get(expressId) ?? []) {
      const group = this.propertyGroup(id, 'occurrence');
      if (group) groups.push(group);
    }
    if (typeId !== null && typeLine) {
      const typeSets = [...refsOf(typeLine.HasPropertySets), ...(index.sets.get(typeId) ?? [])];
      for (const id of new Set(typeSets)) {
        const group = this.propertyGroup(id, 'type');
        if (group) groups.push(group);
      }
    }

    const ownMaterial = index.materials.get(expressId);
    const typeMaterial = typeId === null ? undefined : index.materials.get(typeId);
    const materials =
      ownMaterial !== undefined
        ? this.materialsOf(ownMaterial, 'occurrence')
        : typeMaterial !== undefined
          ? this.materialsOf(typeMaterial, 'type')
          : [];

    const classifications = [
      ...(index.classifications.get(expressId) ?? []).map((id) =>
        this.classificationOf(id, 'occurrence'),
      ),
      ...(typeId === null ? [] : (index.classifications.get(typeId) ?? [])).map((id) =>
        this.classificationOf(id, 'type'),
      ),
    ];

    const containerId = this.nodeIds.has(expressId) ? null : this.containerOf(expressId);
    return {
      expressId,
      globalId: textOf(line.GlobalId) ?? '',
      entity: this.entityOf(expressId),
      predefinedType: textOf(line.PredefinedType),
      name: textOf(line.Name),
      description: textOf(line.Description),
      objectType: textOf(line.ObjectType),
      tag: textOf(line.Tag),
      longName: textOf(line.LongName),
      type,
      container:
        containerId === null
          ? null
          : { entity: this.entityOf(containerId), name: textOf(this.line(containerId)?.Name) },
      storeyName: this.storeyNameOf(expressId),
      groups,
      materials,
      classifications,
      portCount: index.ports.get(expressId) ?? 0,
    };
  }

  /** Libera o modelo na memória do leitor. A sessão não pode mais ser usada. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.lineCache.clear();
    try {
      this.api.CloseModel(this.modelId);
    } catch {
      // O modelo já não estava aberto.
    }
  }
}

/**
 * Abre um arquivo IFC. Lança `IfcReadError` (com mensagem em português) quando o arquivo
 * não é um IFC-SPF, declara um esquema não suportado ou o leitor não consegue abri-lo.
 */
export function openIfcSession(api: IfcAPI, bytes: Uint8Array): IfcSession {
  const sniff = sniffIfc(bytes);
  if (!sniff.ok) throw new IfcReadError(sniff.error.code, sniff.error.message);
  let modelId: number;
  try {
    modelId = api.OpenModel(bytes, {
      // Nada de recentralizar: as coordenadas do arquivo são preservadas.
      COORDINATE_TO_ORIGIN: false,
      // Esquemas preliminares não são lidos "por aproximação".
      ALLOW_INCOMPATIBLE_SCHEMA_ALIASES: false,
    });
  } catch (error) {
    throw new IfcReadError(
      'IFC_OPEN_FAILED',
      `O leitor não conseguiu abrir o arquivo IFC (${error instanceof Error ? error.message : 'erro interno'}). O arquivo pode estar truncado ou corrompido.`,
    );
  }
  if (modelId < 0) {
    throw new IfcReadError(
      'IFC_OPEN_FAILED',
      'O leitor não conseguiu abrir o arquivo IFC. O arquivo pode estar truncado ou corrompido.',
    );
  }
  return new IfcSession(api, modelId, sniff.value);
}
