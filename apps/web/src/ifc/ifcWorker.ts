import { IfcReadError } from '@hydrobim/ifc-import';
import { openIfcSession, type IfcSession } from '@hydrobim/ifc-import/reader';
import { IfcAPI } from 'web-ifc';
import wasmUrl from 'web-ifc/web-ifc.wasm?url';
import type { IfcWorkerRequest, IfcWorkerResponse } from './ifcProtocol';

/**
 * Web Worker de um arquivo IFC: abre o arquivo com o web-ifc (WebAssembly), devolve o resumo
 * e as malhas e continua vivo para responder às consultas de propriedades. Encerrar o worker
 * libera toda a memória do modelo — é assim que a página cancela uma leitura ou descarta um
 * modelo removido.
 */

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<IfcWorkerRequest>) => void) | null;
  postMessage: (message: IfcWorkerResponse, transfer?: Transferable[]) => void;
};

let session: IfcSession | null = null;

async function open(bytes: ArrayBuffer): Promise<void> {
  scope.postMessage({ type: 'progress', progress: { stage: 'opening', fraction: null } });
  const api = new IfcAPI();
  // Uma só linha de execução: a versão com várias exige cabeçalhos de isolamento que uma
  // hospedagem estática (GitHub Pages) não envia. O arquivo .wasm é servido com o aplicativo.
  await api.Init((path) => (path.endsWith('.wasm') ? wasmUrl : path), true);
  session = openIfcSession(api, new Uint8Array(bytes));
  const { summary, meshes } = session.read({
    onProgress: (progress) => scope.postMessage({ type: 'progress', progress }),
  });
  const transfer = meshes.geometries.flatMap((geometry) => [
    geometry.positions.buffer as ArrayBuffer,
    geometry.normals.buffer as ArrayBuffer,
    geometry.indices.buffer as ArrayBuffer,
  ]);
  scope.postMessage({ type: 'ready', summary, meshes }, transfer);
}

scope.onmessage = (event) => {
  const request = event.data;
  if (request.type === 'open') {
    open(request.bytes).catch((error: unknown) => {
      scope.postMessage(
        error instanceof IfcReadError
          ? { type: 'error', code: error.code, message: error.message }
          : {
              type: 'error',
              code: 'IFC_READ_FAILED',
              message: `Falha ao ler o arquivo IFC (${error instanceof Error ? error.message : 'erro interno'}).`,
            },
      );
    });
    return;
  }
  scope.postMessage({
    type: 'properties',
    requestId: request.requestId,
    properties: session ? session.properties(request.expressId) : null,
  });
};
