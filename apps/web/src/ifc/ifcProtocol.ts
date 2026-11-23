import type {
  IfcMeshSet,
  IfcModelSummary,
  IfcObjectProperties,
  IfcReadProgress,
} from '@hydrobim/ifc-import';

/** Mensagens entre a página e o Web Worker que lê um arquivo IFC. */
export type IfcWorkerRequest =
  | { readonly type: 'open'; readonly bytes: ArrayBuffer }
  | { readonly type: 'properties'; readonly requestId: number; readonly expressId: number };

export type IfcWorkerResponse =
  | { readonly type: 'progress'; readonly progress: IfcReadProgress }
  | { readonly type: 'ready'; readonly summary: IfcModelSummary; readonly meshes: IfcMeshSet }
  | { readonly type: 'error'; readonly code: string; readonly message: string }
  | {
      readonly type: 'properties';
      readonly requestId: number;
      readonly properties: IfcObjectProperties | null;
    };
