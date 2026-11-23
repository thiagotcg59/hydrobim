# @hydrobim/ifc-import

Leitura de arquivos IFC de terceiros (IFC-SPF, `.ifc`) com o
[web-ifc](https://github.com/ThatOpen/engine_web-ifc) 0.0.78 (MPL-2.0). Esquemas aceitos e
testados: `IFC2X3`, `IFC4` e `IFC4X3_ADD2`. Uso no editor, suporte comprovado e limites:
`docs/IFC_IMPORT.md`; decisão: ADR-050.

O pacote tem duas entradas, para que só quem lê arquivos carregue o WebAssembly:

| Entrada | Conteúdo | Carrega o web-ifc? |
| --- | --- | --- |
| `@hydrobim/ifc-import` | Tipos do resultado, `sniffIfc` (identificação do arquivo pelo cabeçalho) e `packIfcSource`/`unpackIfcSource` (fonte em gzip + base64, com SHA-256) | Não |
| `@hydrobim/ifc-import/reader` | `openIfcSession(api, bytes)` → `IfcSession` (`read`, `properties`, `close`) | Sim |

```ts
import { IfcAPI } from 'web-ifc';
import { openIfcSession } from '@hydrobim/ifc-import/reader';

const api = new IfcAPI();
await api.Init(); // no navegador: dentro de um Web Worker, com o caminho do .wasm
const session = openIfcSession(api, bytes); // lança IfcReadError (mensagem em português)
const { summary, meshes } = session.read({ onProgress, isCancelled });
const properties = session.properties(expressId); // sob demanda
session.close(); // libera o modelo na memória do leitor
```

## Convenções da saída

- **Metros, radianos e Z para cima**, no referencial do arquivo. O web-ifc entrega metros e Y
  para cima; a troca de eixos é feita uma vez, na matriz de cada peça.
- **Sem recentralizar** (`COORDINATE_TO_ORIGIN: false`): a geometria fica no referencial
  próprio e a posição vai em matrizes 4×4 de dupla precisão.
- `summary`: cabeçalho, unidades, georreferência declarada, estrutura espacial, objetos (com a
  situação da geometria e a envoltória) e o relatório. Todo `IfcProduct` é objeto, nó da
  estrutura ou item do relatório.
- `meshes`: geometrias compartilhadas (instâncias do arquivo continuam instâncias) e, por
  objeto, as peças com matriz e cor declarada. Objeto sem malha não recebe geometria substituta.
- `properties`: atributos, tipo associado, conjuntos de propriedades e de quantidades (da
  ocorrência e do tipo, separados), materiais e classificações — valores, unidades e tipos de
  valor como estão no arquivo.

## Verificação

```powershell
npx vitest run tests/integration/ifcImport.test.ts
cd services/api
uv run python scripts/make_ifc_import_fixtures.py   # regenera os arquivos de teste
uv run pytest -q tests/test_ifc_import_fixtures.py
```

O teste de integração compara o que este leitor devolve com o que o IfcOpenShell lê dos
mesmos arquivos (`tests/fixtures/ifc-import/*.expected.json`).
