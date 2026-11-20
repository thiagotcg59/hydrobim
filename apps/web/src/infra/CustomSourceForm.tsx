import { useState } from 'react';
import { checkCustomSource, ESRI_WORLD_IMAGERY, esriWorldImagerySource } from '../map/customSource';
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

  const [esriKey, setEsriKey] = useState('');

  /** Atalho: o usuário cola só a chave; endereço, atribuição e nível vêm da documentação da Esri. */
  const applyEsri = (): void => {
    const checked = esriWorldImagerySource(esriKey);
    if (!checked.ok) {
      setError(checked.message);
      return;
    }
    setError(null);
    setUrlTemplate(checked.value.urlTemplate);
    setAttribution(checked.value.attribution);
    setMaxZoom(String(checked.value.maxZoom));
    setEsriKey('');
    const store = useEditorStore.getState();
    store.setCustomBasemap(checked.value);
    store.notify(
      'success',
      `${ESRI_WORLD_IMAGERY.name} gravada neste navegador. Escolha "Personalizada" na lista de mapas.`,
    );
  };

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
        <span>
          {ESRI_WORLD_IMAGERY.name}: chave de API da sua conta gratuita em{' '}
          <a href={ESRI_WORLD_IMAGERY.signupUrl} target="_blank" rel="noreferrer">
            location.arcgis.com
          </a>
        </span>
        <input
          data-testid="custom-source-esri-key"
          value={esriKey}
          type="password"
          autoComplete="off"
          placeholder="Cole aqui a chave de API"
          spellCheck={false}
          onChange={(event) => setEsriKey(event.target.value)}
        />
      </label>
      <div className="chips">
        <button
          type="button"
          className="btn"
          data-testid="custom-source-esri-apply"
          onClick={applyEsri}
        >
          Usar {ESRI_WORLD_IMAGERY.name}
        </button>
      </div>
      <span className="muted">Ou informe outro serviço:</span>
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
