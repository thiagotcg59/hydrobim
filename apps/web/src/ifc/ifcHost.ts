import {
  IfcReadError,
  type IfcMeshSet,
  type IfcModelSummary,
  type IfcObjectProperties,
  type IfcReadProgress,
} from '@hydrobim/ifc-import';
import type { IfcWorkerRequest, IfcWorkerResponse } from './ifcProtocol';

/**
 * Leitor de UM arquivo IFC, fora da linha principal. `dispose` encerra o worker: interrompe
 * a leitura em andamento e libera a memória do modelo.
 */
export interface IfcHost {
  open(
    bytes: Uint8Array,
    onProgress: (progress: IfcReadProgress) => void,
  ): Promise<{ summary: IfcModelSummary; meshes: IfcMeshSet }>;
  properties(expressId: number): Promise<IfcObjectProperties | null>;
  dispose(): void;
}

export type IfcHostFactory = () => IfcHost;

function createWorkerHost(): IfcHost {
  const worker = new Worker(new URL('./ifcWorker.ts', import.meta.url), { type: 'module' });
  let disposed = false;
  let nextRequest = 1;
  const pending = new Map<number, (properties: IfcObjectProperties | null) => void>();
  let onProgress: (progress: IfcReadProgress) => void = () => undefined;
  let settle: {
    resolve: (value: { summary: IfcModelSummary; meshes: IfcMeshSet }) => void;
    reject: (error: Error) => void;
  } | null = null;

  worker.onmessage = (event: MessageEvent<IfcWorkerResponse>) => {
    const message = event.data;
    if (message.type === 'progress') onProgress(message.progress);
    else if (message.type === 'ready') {
      settle?.resolve({ summary: message.summary, meshes: message.meshes });
      settle = null;
    } else if (message.type === 'error') {
      settle?.reject(new IfcReadError(message.code, message.message));
      settle = null;
    } else {
      pending.get(message.requestId)?.(message.properties);
      pending.delete(message.requestId);
    }
  };
  worker.onerror = (event) => {
    event.preventDefault();
    settle?.reject(
      new IfcReadError(
        'IFC_WORKER',
        `O leitor IFC parou de responder (${event.message || 'erro interno'}). Arquivos muito grandes podem exceder a memória do navegador.`,
      ),
    );
    settle = null;
  };

  return {
    open(bytes, progress) {
      onProgress = progress;
      return new Promise((resolve, reject) => {
        settle = { resolve, reject };
        // Cópia própria do worker: a página continua com os bytes para guardar no projeto.
        const copy = bytes.slice().buffer;
        worker.postMessage({ type: 'open', bytes: copy } satisfies IfcWorkerRequest, [copy]);
      });
    },
    properties(expressId) {
      if (disposed) return Promise.resolve(null);
      return new Promise((resolve) => {
        const requestId = nextRequest;
        nextRequest += 1;
        pending.set(requestId, resolve);
        worker.postMessage({ type: 'properties', requestId, expressId } satisfies IfcWorkerRequest);
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      worker.terminate();
      settle?.reject(new IfcReadError('IFC_CANCELLED', 'Importação cancelada.'));
      settle = null;
      for (const resolve of pending.values()) resolve(null);
      pending.clear();
    },
  };
}

let factory: IfcHostFactory = createWorkerHost;

export const createIfcHost = (): IfcHost => factory();

/** Troca o leitor (os testes em Node usam um leitor no mesmo processo, sem Worker). */
export function setIfcHostFactory(next: IfcHostFactory | null): void {
  factory = next ?? createWorkerHost;
}
