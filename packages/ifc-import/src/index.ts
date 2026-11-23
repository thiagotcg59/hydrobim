// Parte do pacote que NÃO carrega o web-ifc: tipos, identificação do arquivo e
// empacotamento da fonte. O leitor fica em `@hydrobim/ifc-import/reader`, para que só o
// Web Worker (e os testes) tragam o WebAssembly.
export * from './header';
export * from './source';
export * from './types';
