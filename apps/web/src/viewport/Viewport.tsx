import { Canvas } from '@react-three/fiber';
import { Suspense, useMemo } from 'react';
import { TerrainDrapeNotice } from '../terrain/TerrainDrapeNotice';
import { ErrorBoundary } from '../ui/ErrorBoundary';
import { SceneContent } from './SceneContent';

function isWebGLAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

export function Viewport() {
  const webgl = useMemo(isWebGLAvailable, []);

  if (!webgl) {
    return (
      <div className="viewport-fallback" role="alert">
        <strong>WebGL indisponível.</strong>
        <span>
          O viewport 3D exige um navegador com WebGL habilitado. Verifique a aceleração gráfica do
          navegador.
        </span>
      </div>
    );
  }

  return (
    <ErrorBoundary
      title="Falha ao renderizar o viewport 3D"
      hint="O modelo não foi perdido. Tente recarregar a página; se persistir, exporte o projeto em JSON."
    >
      <Suspense fallback={<div className="viewport-fallback">Carregando viewport 3D…</div>}>
        <Canvas
          data-testid="viewport-canvas"
          camera={{ position: [7, -9, 7], up: [0, 0, 1], fov: 45, near: 0.01, far: 5000 }}
          gl={{ antialias: true, preserveDrawingBuffer: true }}
          dpr={[1, 2]}
        >
          <SceneContent />
        </Canvas>
        <TerrainDrapeNotice />
      </Suspense>
    </ErrorBoundary>
  );
}
