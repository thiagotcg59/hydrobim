import { fail, ok, type Result } from '@hydrobim/core';
import type { IfcSchemaFamily } from './types';

/**
 * Identificação do arquivo antes de entregá-lo ao leitor: é um IFC-SPF (texto STEP)? De que
 * esquema? Função pura, sem WebAssembly — serve para recusar cedo, com o motivo, o que não é
 * suportado.
 */

/** Esquemas aceitos: identificador declarado → família implementada e testada. */
export const SUPPORTED_IFC_SCHEMAS: Readonly<Record<string, IfcSchemaFamily>> = {
  IFC2X3: 'IFC2X3',
  IFC4: 'IFC4',
  IFC4X3_ADD2: 'IFC4X3',
};

export interface IfcSniff {
  readonly schema: string;
  readonly family: IfcSchemaFamily;
}

const HEAD_BYTES = 256 * 1024;

export function sniffIfc(bytes: Uint8Array): Result<IfcSniff> {
  if (bytes.byteLength === 0) {
    return fail('IFC_EMPTY', 'O arquivo está vazio.');
  }
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    return fail(
      'IFC_ZIP_UNSUPPORTED',
      'O arquivo é um pacote compactado (ifcZIP). Extraia o .ifc e importe-o: só o formato de texto IFC-SPF é lido.',
    );
  }
  // O cabeçalho STEP é ASCII; latin1 evita qualquer falha de decodificação.
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, HEAD_BYTES));
  // Marca de ordem de bytes (UTF-8 lido como latin1, ou já decodificada) antes do cabeçalho.
  const trimmed = head.replace(/^(?:\u00ef\u00bb\u00bf|\ufeff)/, '').trimStart();
  if (trimmed.startsWith('<')) {
    return fail(
      'IFC_XML_UNSUPPORTED',
      'O arquivo é um ifcXML. Só o formato de texto IFC-SPF (.ifc) é lido.',
    );
  }
  if (!/^ISO-10303-21\s*;/.test(trimmed)) {
    return fail(
      'IFC_NOT_STEP',
      'O arquivo não é um IFC válido: falta o cabeçalho "ISO-10303-21" do formato IFC-SPF.',
    );
  }
  const match = /FILE_SCHEMA\s*\(\s*\(\s*'([^']*)'/i.exec(head);
  if (!match || !match[1]) {
    return fail('IFC_NO_SCHEMA', 'O arquivo não declara o esquema IFC (FILE_SCHEMA) no cabeçalho.');
  }
  const schema = match[1].trim().toUpperCase();
  const family = SUPPORTED_IFC_SCHEMAS[schema];
  if (!family) {
    return fail(
      'IFC_SCHEMA_UNSUPPORTED',
      `O arquivo declara o esquema ${schema}, que não é suportado. Esquemas lidos: ${Object.keys(SUPPORTED_IFC_SCHEMAS).join(', ')}.`,
    );
  }
  if (!/ENDSEC\s*;[\s\S]*\bDATA\s*;/.test(head) && bytes.byteLength <= HEAD_BYTES) {
    return fail('IFC_NO_DATA', 'O arquivo IFC não tem a seção de dados (DATA).');
  }
  return ok({ schema, family });
}
