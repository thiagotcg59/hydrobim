# Importação de modelos IFC

Objetos e modelos de arquivos `.ifc` de terceiros entram no projeto como **referência**: são vistos, selecionados, consultados, posicionados e capturados junto da rede hidráulica e da arquitetura, mas não viram tubos, paredes nem equipamentos editáveis e **não criam conexões hidráulicas**. Decisão e alternativas: ADR-050 (`docs/DECISIONS.md`).

## Como usar

1. **Arquivo › Importar IFC…** (ou **BIM / IFC › Modelos IFC › Importar IFC…**, ou a busca de comandos). Escolha um arquivo `.ifc` do computador. O arquivo é lido no próprio navegador, em um Web Worker; nada é enviado a servidores.
2. **Andamento**: o diálogo mostra a etapa (abrindo, estrutura, geometria). **Cancelar a leitura** encerra o leitor e não altera o projeto.
3. **Prévia**: modelo 3D como está no arquivo, esquema, unidades, pavimentos com as cotas, quantidade de objetos e de triângulos, envoltória, georreferência declarada e o **relatório da leitura**.
4. **O que importar**: "Modelo completo", "Nenhum", caixas por **categoria** (entidade IFC), **árvore** (estrutura espacial › categoria › objeto, com caixas de três estados) e **busca** por nome, classe ou GlobalId ("Marcar encontrados" / "Desmarcar encontrados").
5. **Posicionar…**: o diálogo sai da frente e o painel direito vira o do posicionamento. A prévia aparece nas vistas — tracejada em verde na planta, translúcida no Modelo 3D — **com a mesma transformação que a confirmação grava**:
   - **Manter as coordenadas originais**: o modelo entra onde o arquivo o coloca.
   - **Posicionar por ponto-base**: um ponto do modelo (começa no canto de menores X, Y e Z do que foi escolhido; "Ponto-base" permite indicá-lo sobre a prévia) é levado ao destino (digitado ou indicado na vista); giro em torno do ponto-base.
   - **Informar deslocamento e rotação**: giro em torno da origem do arquivo e ΔX, ΔY, ΔZ.
   - **Alinhar por referências**: 1º ponto do modelo → destino 1 e, opcionalmente, 2º ponto → destino 2 (desloca e gira em planta, sem escala). Pontos do modelo são capturados nos vértices da prévia; destinos, em vértices de modelos já importados, portas, elementos, grade ou plano de trabalho.
   - O quadro **Resultado** mostra deslocamento, giro e a envoltória final. **Confirmar e inserir** grava um passo no histórico; **Cancelar** não altera nada; **Voltar à seleção** reabre o diálogo.
6. **Depois de inserir**: ramo **Modelos IFC** do navegador (arquivo › estrutura espacial › categoria › objeto), clique no 3D, na planta ou nas vistas salvas para selecionar, painel de propriedades e os comandos de mover, girar, copiar, ocultar, isolar, enquadrar e remover.

## O que o painel mostra

- **Modelo** (clique na linha do arquivo): nome no projeto, arquivo, esquema, unidade de comprimento e o fator para metros, tamanho, SHA-256, data da importação, situação da fonte, objetos incluídos, cópias, objetos sem geometria, transformação e envoltória, visibilidade e **opacidade** (5 % a 100 %).
- **Objeto**: arquivo de origem, GlobalId original, entidade IFC, tipo predefinido, tipo associado, nome, descrição, tipo de objeto, etiqueta, pavimento, identidade interna, linha no arquivo; representação lida e envoltória no projeto; materiais (camadas com espessura, constituintes, listas, perfis), classificações e todos os conjuntos de propriedades e de quantidades.
- Cada valor traz a **natureza**: *Recebido* (lido do arquivo, na ocorrência), *Recebido do tipo* (lido no `Ifc…Type` associado — os conjuntos do tipo ficam em seções separadas, marcadas "(tipo)"), *Calculado* (pelo HydroBIM: posição, envoltória, identidade) e *Não informado* (o arquivo não traz o valor; nada é preenchido).
- Valores, **unidades e tipos de valor são os do arquivo**: uma altura de `2800` em um arquivo em milímetros aparece como `2.800 mm`, com `IfcLengthMeasure`. A unidade vem da própria propriedade ou, na falta, da unidade declarada no arquivo para aquele tipo de medida; sem declaração, o valor fica sem unidade.

## Suporte comprovado

| Item | Situação | Evidência |
| --- | --- | --- |
| Esquema `IFC2X3` | Lido e testado | `predio-ifc2x3-m.ifc` |
| Esquema `IFC4` | Lido e testado | `predio-ifc4-mm.ifc`, `predio-ifc4-pe.ifc` |
| Esquema `IFC4X3_ADD2` | Lido e testado | `predio-ifc4x3-m.ifc` e os arquivos que o próprio HydroBIM exporta (`examples/edificacao-simples.ifc`) |
| Demais identificadores (`IFC4X1`, `IFC4X3_RC*`, `IFC4X3`, `IFC2X2`…) | **Identificados e recusados**, com a lista dos esquemas lidos | teste de arquivos inválidos |
| Formato | Só IFC-SPF (texto `.ifc`). ifcXML e ifcZIP são identificados e recusados | idem |
| Unidades de comprimento | Metro, milímetro (prefixo SI) e pé (unidade por conversão) conferidos; outras unidades SI/por conversão são lidas do arquivo pela mesma regra, sem arquivo de teste próprio | os quatro arquivos descrevem a mesma edificação e ocupam os mesmos metros |
| Posicionamento hierárquico | Terreno → edifício (girado 30°) → pavimento → elemento (girado 90°; referencial inclinado 20°) | caixa envolvente de cada objeto igual à do IfcOpenShell (0,5 mm) |
| Instâncias (`IfcMappedItem`) | Geometria compartilhada entre as ocorrências, com a transformação de cada uma | três pilares, um deles girado 45° |
| Vãos (`IfcOpeningElement`) | Aplicados como recorte no hospedeiro | volume da parede com vão igual ao do IfcOpenShell |
| Cor de apresentação (`IfcStyledItem`) | Lida do arquivo | parede com cor declarada |
| Coordenadas grandes | Preservadas, sem recentralizar (posição na matriz, em dupla precisão) | arquivo com origem em (350 000; 7 400 000; 400) m |
| Propriedades | `IfcPropertySingleValue`, enumeradas, com faixa, de lista; quantidades de comprimento, área, volume, contagem, peso e tempo; propriedades do tipo separadas | valores iguais aos do IfcOpenShell |
| Materiais | `IfcMaterial`, camadas (com `Usage`), lista, constituintes (IFC4+), perfis; herdado do tipo identificado como tal | idem |
| Classificações | `IfcClassificationReference` (IFC2X3 e IFC4+) | idem |
| Georreferência | `IfcMapConversion` + `IfcProjectedCRS` **lidos e mostrados**; não aplicados | arquivo IFC4 de teste |

Leitor: [web-ifc](https://github.com/ThatOpen/engine_web-ifc) 0.0.78 (MPL-2.0), em WebAssembly, com uma linha de execução (funciona em hospedagem estática, sem cabeçalhos de isolamento). Não é declarado suporte universal ao IFC: o que está comprovado é o que a tabela lista, com os arquivos de teste descritos abaixo.

## Relatório da leitura (nada é descartado em silêncio)

Todo `IfcProduct` do arquivo é um objeto importável, um nó da estrutura espacial ou um item do relatório:

- **Sem representação geométrica** (ex.: porta só com dados) e **representação não convertida em malha** (eixos, curvas, anotações 2D — com o identificador e o tipo da representação): o objeto pode ser importado, entra na árvore e nas propriedades e fica marcado "sem geometria". **Nenhuma caixa ou forma substituta é desenhada.**
- **Falha do leitor** ao gerar a geometria de um objeto: idem.
- **Vãos**: aplicados como recorte nos hospedeiros; não são objetos importáveis.
- **Portas IFC** (`IfcDistributionPort`): só contadas e mostradas no objeto; não criam conexões.
- **Objetos fora da estrutura espacial**: ficam no nó "Fora da estrutura espacial".
- **Georreferência declarada**: mostrada, não aplicada.

## Coordenadas, unidades e georreferência

- Internamente tudo fica em **metros, radianos e Z para cima**. O web-ifc entrega metros e Y para cima; a troca de eixos é feita uma única vez, na matriz de cada peça (`packages/ifc-import/src/reader.ts`).
- **Nada é recentralizado.** A geometria fica no referencial próprio (números pequenos, precisão simples) e a posição vai em matrizes de dupla precisão; as vistas usam a origem de renderização do editor (`editor/renderOrigin.ts`), como a rede em coordenadas UTM. Os dados de engenharia (transformações gravadas, envoltórias, pontos capturados) não passam por precisão simples.
- A transformação gravada é rígida e em planta: giro em torno de Z e translação (`IfcTransform`). **Sem escala e sem inclinação** — a geometria do arquivo é preservada.
- **Georreferência**: o HydroBIM mostra `IfcMapConversion`/`IfcProjectedCRS` como declarados e **não os aplica**, nem presume EPSG. Para posicionar um modelo georreferenciado, use o ponto-base ou o deslocamento com os valores desejados. `ePSet_MapConversion` (convenção do IFC2X3) e `RefLatitude`/`RefLongitude` do terreno não são interpretados.

## Identidade

| Identidade | Origem | Uso |
| --- | --- | --- |
| `model.id` | Gerada a cada inserção | Distingue modelos — inclusive duas inserções do mesmo arquivo |
| `object.id` | Gerada para cada objeto incluído e para cada cópia | Identidade interna persistente (seleção, histórico, visibilidade) |
| `object.globalId`, `object.expressId` | Do arquivo | Aponta a entidade de origem; uma cópia repete os dois e tem `copy: true` |
| `source.sha256` | Do arquivo | Identifica o arquivo-fonte; modelos do mesmo arquivo compartilham a leitura |

## Persistência

`project.ifcModels` (esquema v19; `docs/DOMAIN_MODEL.md`) guarda, por modelo: o **arquivo-fonte íntegro** (gzip + base64, com tamanho e SHA-256 do original), esquema, unidade, data, o modo e a transformação do posicionamento, visibilidade, opacidade e a lista de objetos incluídos (identidade interna, `expressId`, `GlobalId`, transformação própria e se é cópia).

- **Malhas e propriedades não são gravadas**: são relidas da fonte ao abrir o projeto, ao desfazer a remoção de um modelo etc. O arquivo-fonte nunca é alterado; as transformações ficam à parte.
- **Baixar arquivo** (`.hydrobim.json`) leva a fonte embutida: o arquivo é autossuficiente e reabre em qualquer computador.
- **Salvar no navegador**: o documento vai para o `localStorage` sem a fonte, que fica no IndexedDB (banco `hydrobim-ifc-sources`, por SHA-256) e volta ao abrir. Se o IndexedDB tiver sido limpo, o projeto abre, o modelo aparece como "fonte ausente" e o painel oferece **Religar arquivo original** — aceito só se o SHA-256 conferir.
- **Memória**: cada arquivo lido tem o seu Web Worker; remover o último modelo de um arquivo (ou cancelar a importação) encerra o worker e libera as geometrias da placa de vídeo. Desfazer a remoção relê a fonte.

## Integração com o editor

- **Vistas**: Modelo 3D (malhas do arquivo, com a caixa de corte e o estilo aramado da vista 3D), planta de trabalho, plantas por nível, cortes e elevações. Nas vistas 2D o objeto é desenhado pelas **arestas vivas** da malha e, onde um plano de corte o atravessa, pelo **contorno da seção** (traço mais forte). A categoria "Modelos IFC importados" pode ser ocultada em cada vista.
- **Seleção**: clique no 3D, no traço em planta ou na árvore; Ctrl/Shift somam; é exclusiva com a seleção da rede, da arquitetura e do terreno. Clicar a linha do arquivo seleciona o modelo inteiro.
- **Visibilidade**: o olho do modelo e a opacidade são dados do projeto (com desfazer); **ocultar, isolar e mostrar todos** os objetos valem para a sessão.
- **Modificar** (painel de propriedades): mover por ΔX/ΔY/ΔZ, girar em torno do centro da seleção, copiar componentes (identidades novas), remover objetos ou o modelo. Um passo do histórico por ação; Del remove a seleção.
- **Capturas**: os vértices e arestas dos objetos importados **à mostra** servem de referência.
  - Ferramentas da rede (tubo, peças, medir): no 3D, o vértice sob o cursor (rótulo "Vértice de objeto IFC importado"); na planta, o X e o Y do vértice, com a cota do plano de desenho.
  - Ferramentas da arquitetura: as arestas entram no motor de capturas da planta (extremidade, meio, interseção, perpendicular, sobre a aresta), com a tolerância em pixels e a prioridade de sempre.
  - A captura grava só o ponto: nenhum vínculo e nenhuma conexão hidráulica nascem dela.

## Exportações

| Saída | Objetos importados |
| --- | --- |
| Arquivo do projeto (`.hydrobim.json`) | **Completos**: fonte, objetos incluídos e transformações |
| IFC 4.3, DXF (planta e 3D), CSV, INP (EPANET), IDS | **Não entram.** O diálogo Exportação avisa quando o projeto tem modelos importados, e as mensagens das exportações IFC, DXF do modelo 3D, CSV e INP repetem o aviso |
| Planta em SVG | Leva os traços dos objetos importados que estiverem à mostra na vista |

Para entregar o conjunto em IFC, use o arquivo original ao lado do IFC exportado pelo HydroBIM (federação por arquivos).

## Limites

- **100 MB** por arquivo e **50 000 objetos** por modelo (`IFC_IMPORT_LIMITS`); acima disso a importação é recusada com o motivo. O limite prático de memória depende do navegador: o leitor guarda o modelo em um Web Worker e as malhas na página.
- **Vistas 2D**: até 4 000 objetos importados por vista; o excedente é informado na vista e continua no Modelo 3D. Sem remoção de linhas ocultas nem hachura da seção.
- Posicionamento rígido em planta: sem escala, sem espelhamento e sem inclinação.
- Operador de instância com eixos parciais (`IfcCartesianTransformationOperator3D` só com `Axis1`): o web-ifc 0.0.78 não deriva os demais eixos e a instância sai distorcida — constatado na conferência com o IfcOpenShell. Com os eixos informados o resultado confere.
- Propriedades de tabela, de referência e complexas, e quantidades complexas: listadas pelo nome, sem leitura do conteúdo.
- Alinhamentos, grades e anotações (curvas) não são convertidos em malha: entram sem geometria, pelo relatório.
- Seleção por janela, menu do botão direito, percurso e realidade virtual não incluem os objetos importados. Mover e girar são por valores (não há arrasto nas vistas).
- Capturas: vértices nas ferramentas da rede; o cruzamento de rede com objeto importado não é verificado (a detecção de interferências é só entre tubos).
- Os conjuntos de propriedades importados não são editáveis nem entram na validação IFC/IDS do projeto.
- Arquivos reais de ferramentas de autoria (Revit, ArchiCAD, Civil 3D etc.) ainda não foram exercitados nesta base de testes: os arquivos de teste são sintéticos.

## Arquivos de teste e conferência independente

- `tests/fixtures/ifc-import/*.ifc`: **sintéticos**, escritos pelo IfcOpenShell por `services/api/scripts/make_ifc_import_fixtures.py` (do próprio projeto; não derivam de modelos de terceiros). A mesma edificação em IFC2X3/metros, IFC4/milímetros (com georreferência), IFC4/pés e IFC4X3_ADD2/metros com coordenadas grandes.
- `*.expected.json`: o que o **IfcOpenShell** lê de cada arquivo (caixa envolvente e volume por objeto, pavimento, tipo, materiais, propriedades e quantidades).
- `tests/integration/ifcImport.test.ts`: o leitor do editor (web-ifc) abre os mesmos arquivos e é comparado com esses valores.
- `services/api/tests/test_ifc_import_fixtures.py`: o IfcOpenShell valida cada arquivo contra o esquema e confere que os valores gravados continuam sendo os que ele lê; também valida, pelo contrato do backend, um projeto com modelo importado.
- `apps/web/src/ifc/ifcStore.test.ts`: assistente, posicionamento, cancelamento, edição com desfazer/refazer, capturas, salvar e reabrir.
- `tests/e2e/ifcImport.spec.ts`: o fluxo completo no navegador real (Web Worker e WebAssembly).

Para regenerar os arquivos de teste: `cd services/api && uv run python scripts/make_ifc_import_fixtures.py`.

## Onde está o código

| Parte | Caminho |
| --- | --- |
| Esquema e operações puras (`addIfcModel`, `transformIfcModels`, `transformIfcObjects`, `copyIfcObjects`, `removeIfcObjects`…) | `packages/core/src/schema.ts`, `ifcModels.ts` |
| Leitor (estrutura, objetos, malhas, unidades, propriedades), identificação do arquivo e empacotamento da fonte | `packages/ifc-import` |
| Arestas vivas e contorno de seção de malhas | `packages/geometry/src/meshEdges.ts` |
| Worker, sessão, assistente, camadas 3D/2D, navegador, painéis | `apps/web/src/ifc/` |
| Fontes no navegador (IndexedDB) | `apps/web/src/persistence/ifcSourceStore.ts` |
