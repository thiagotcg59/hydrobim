import { useState } from 'react';
import { checkCustomSource } from '../map/customSource';
import { useEditorStore } from '../state/editorStore';

/**
 * Cadastro da fonte de mapa personalizada: o endereço de ladrilhos de um serviço ao qual o
 * usuário tem direito (ortofoto de alta resolução, serviço contratado). Fica guardado só neste
 * navegador; a interface não julga a licença — por isso a imagem não entra em exportações.
 */
export function CustomSourceForm() {
  const current = useEditorStore((s) => s.customBasemap);
  const [urlTemplate, setUrlTemplate] = useState(current?.urlTemplate ?? '');
  const [attribution, setAttribution] = useState(current?.attribution ?? '');
  const [maxZoom, setMaxZoom] = useState(String(current?.maxZoom ?? 19));
  const [error, setError] = useState<string | null>(null);

  const save = (): void => {
    const checked = checkCustomSource({ urlTemplate, attribution, maxZoom: Number(maxZoom) });
    if (!checked.ok) {
      setError(checked.message);
      return;
    }
    setError(null);
    const store = useEditorStore.getState();
    store.setCustomBasemap(checked.value);
    store.notify('success', 'Fonte de mapa personalizada gravada neste navegador.');
  };

  return (
    <div
      className="infra__custom"
      data-testid="custom-source-form"
      onKeyDown={(event) => event.stopPropagation()}
    >
      <span className="muted">
        Para imagem de alta resolução, informe o endereço de ladrilhos (Web Mercator) de um serviço
        ao qual você tem direito — com a sua chave, se houver. O endereço fica guardado só neste
        navegador: não entra no projeto nem nas exportações. Confira os termos de uso do serviço.
      </span>
      <label className="plan__field plan__field--block">
        <span>Endereço dos ladrilhos</span>
        <input
          data-testid="custom-source-url"
          value={urlTemplate}
          placeholder="https://servidor/camada/{z}/{x}/{y}.jpg"
          spellCheck={false}
          onChange={(event) => setUrlTemplate(event.target.value)}
        />
      </label>
      <label className="plan__field plan__field--block">
        <span>Atribuição exigida pelo serviço</span>
        <input
          data-testid="custom-source-attribution"
          value={attribution}
          placeholder="© Fornecedor da imagem"
          onChange={(event) => setAttribution(event.target.value)}
        />
      </label>
      <label className="plan__field">
        <span>Nível máximo de zoom</span>
        <input
          data-testid="custom-source-zoom"
          value={maxZoom}
          inputMode="numeric"
          onChange={(event) => setMaxZoom(event.target.value)}
        />
      </label>
      {error && (
        <span className="warn" data-testid="custom-source-error">
          {error}
        </span>
      )}
      <div className="chips">
        <button type="button" className="btn" data-testid="custom-source-save" onClick={save}>
          Gravar fonte
        </button>
        {current && (
          <button
            type="button"
            className="btn"
            data-testid="custom-source-remove"
            onClick={() => {
              useEditorStore.getState().setCustomBasemap(null);
              setUrlTemplate('');
              setAttribution('');
            }}
          >
            Remover
          </button>
        )}
      </div>
    </div>
  );
}
