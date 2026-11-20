import { describe, expect, it } from 'vitest';
import { setDrawingScale } from './annotations';
import { vec3 } from './math';
import { addPipe, createProject } from './operations';
import { setGeoreference, setInfraSettings } from './projectOps';
import { defaultInfraSettings, SCHEMA_VERSION, type Project } from './schema';
import { parseProject, parseProjectDocument, serializeProject } from './serialization';
import { testSpec } from './testSupport';
import { validateProject } from './validation';

function network(): Project {
  const created = addPipe(createProject('Adutora', 'infra'), {
    start: vec3(0, 0, 0),
    end: vec3(120, 0, 0),
    spec: testSpec(150),
  });
  if (!created.ok) throw new Error(created.error.message);
  return created.value.project;
}

describe('configuração do ambiente Infra', () => {
  it('nasce com fundo técnico, todas as camadas e sem nada geográfico presumido', () => {
    const project = createProject('Novo', 'infra');
    expect(project.infra).toEqual(defaultInfraSettings());
    expect(project.infra.basemap.sourceId).toBeNull();
    expect(project.georeference).toBeNull();
  });

  it('altera escala, mapa, camadas e rótulos sem mutar o projeto nem os dados de engenharia', () => {
    const project = network();
    const result = setInfraSettings(project, {
      drawingScale: 2000,
      basemap: { sourceId: 'eox-s2cloudless-2017', opacity: 0.6 },
      layers: { terrain: false },
      labels: { lengths: true },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const next = result.value;
    expect(next.infra).toEqual({
      drawingScale: 2000,
      basemap: { sourceId: 'eox-s2cloudless-2017', visible: true, opacity: 0.6 },
      layers: {
        network: true,
        equipment: true,
        terrain: false,
        references: true,
        annotations: true,
      },
      labels: { names: false, lengths: true, elevations: false },
    });
    // O projeto recebido não muda; elementos, conexões e identificadores são os mesmos objetos.
    expect(project.infra).toEqual(defaultInfraSettings());
    expect(next.elements).toBe(project.elements);
    expect(next.connections).toBe(project.connections);
    expect(validateProject(next)).toEqual([]);
  });

  it('é independente da planta do MEP', () => {
    const project = network();
    const infra = setInfraSettings(project, { drawingScale: 5000 });
    if (!infra.ok) throw new Error(infra.error.message);
    expect(infra.value.drawingScale).toBe(project.drawingScale);
    const mep = setDrawingScale(infra.value, 25);
    if (!mep.ok) throw new Error(mep.error.message);
    expect(mep.value.infra.drawingScale).toBe(5000);
    expect(mep.value.drawingScale).toBe(25);
  });

  it('recusa valores inválidos e não registra alteração sem mudança', () => {
    const project = network();
    const code = (patch: Parameters<typeof setInfraSettings>[1]) => {
      const r = setInfraSettings(project, patch);
      return r.ok ? 'ok' : r.error.code;
    };
    expect(code({ drawingScale: 0 })).toBe('INVALID_INFRA_SETTINGS');
    expect(code({ drawingScale: Number.NaN })).toBe('INVALID_INFRA_SETTINGS');
    expect(code({ basemap: { opacity: 1.5 } })).toBe('INVALID_INFRA_SETTINGS');
    expect(code({ basemap: { sourceId: '' } })).toBe('INVALID_INFRA_SETTINGS');
    const same = setInfraSettings(project, { layers: { network: true } });
    expect(same.ok && same.value).toBe(project);
  });

  it('salvar e reabrir preserva a georreferência e a configuração Infra', () => {
    const geo = setGeoreference(network(), {
      crsName: 'SIRGAS 2000 / UTM zone 23S',
      epsg: 31983,
      eastings: 333287.0215,
      northings: 7394586.0934,
      orthogonalHeight: 760,
      rotation: 0.3,
      verticalDatum: 'Imbituba',
    });
    if (!geo.ok) throw new Error(geo.error.message);
    const configured = setInfraSettings(geo.value, {
      drawingScale: 2000,
      basemap: { sourceId: 'eox-s2cloudless-2017', visible: false, opacity: 0.4 },
      labels: { names: true, elevations: true },
    });
    if (!configured.ok) throw new Error(configured.error.message);
    const reopened = parseProject(serializeProject(configured.value));
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;
    expect(reopened.value).toEqual(configured.value);
    expect(reopened.value.georeference).toEqual(configured.value.georeference);
    expect(reopened.value.infra).toEqual(configured.value.infra);
  });
});

describe('migração do esquema v10 para o v11', () => {
  function asV10(project: Project): Record<string, unknown> {
    const { infra: _infra, ...rest } = project;
    return { ...rest, schemaVersion: 10 };
  }

  it('documento MEP v10 ganha a configuração Infra padrão e mantém a sua escala', () => {
    const base = createProject('Predial', 'mep');
    const migrated = parseProjectDocument({ ...asV10(base), drawingScale: 25 });
    expect(migrated.ok).toBe(true);
    if (!migrated.ok) return;
    expect(migrated.value.schemaVersion).toBe(SCHEMA_VERSION);
    expect(migrated.value.drawingScale).toBe(25);
    expect(migrated.value.infra).toEqual(defaultInfraSettings());
    expect(migrated.value.georeference).toBeNull();
  });

  it('documento Infra v10 leva a escala da planta para a Planta Infra', () => {
    const migrated = parseProjectDocument({ ...asV10(network()), drawingScale: 500 });
    expect(migrated.ok).toBe(true);
    if (!migrated.ok) return;
    expect(migrated.value.infra.drawingScale).toBe(500);
    expect(migrated.value.infra.basemap.sourceId).toBeNull();
    expect(migrated.value.elements).toHaveLength(1);
  });

  it('a georreferência v10 é preservada e a referência altimétrica fica não informada', () => {
    const legacy = {
      crsName: 'SIRGAS 2000 / UTM zone 23S',
      epsg: 31983,
      eastings: 333287.0215,
      northings: 7394586.0934,
      orthogonalHeight: 760,
      rotation: 0.3,
    };
    const migrated = parseProjectDocument({ ...asV10(network()), georeference: legacy });
    expect(migrated.ok).toBe(true);
    if (!migrated.ok) return;
    expect(migrated.value.georeference).toEqual({ ...legacy, verticalDatum: null });
  });
});
