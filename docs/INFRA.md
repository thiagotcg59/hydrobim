# Ambiente Infra

Redes externas — loteamentos, redes urbanas e adutoras de vários quilômetros — têm necessidades diferentes das instalações prediais: referencial geográfico, mapa de fundo, escalas de 1:500 a 1:10.000, coordenadas grandes, terreno e perfil. Este documento registra o diagnóstico que orientou o ambiente Infra, a arquitetura adotada, o que a primeira entrega contém e o que fica para as etapas seguintes.

Decisão correspondente: [ADR-036](DECISIONS.md).

## Diagnóstico (antes desta entrega)

| Recurso | Situação encontrada |
| --- | --- |
| Ambiente | `discipline: 'infra'` trocava só a especificação padrão, o passo da grade e a escala inicial; a planta era a mesma do MEP |
| Georreferência | Seis campos digitados, sem validação; servia só ao `IfcMapConversion`. Nenhuma transformação para coordenadas geográficas |
| Mapa | Inexistente |
| Coordenadas grandes | A projeção em planta (`PlanOutline`) era gravada em precisão simples e o SVG recebia coordenadas absolutas: em N ≈ 7.400.000 m o passo representável é de 0,5 m. No 3D, o terreno ia para a placa de vídeo em coordenadas absolutas |
| Planta | Sempre a geometria completa de todos os elementos (projeção com linhas ocultas), sem recorte pela janela nem nível de detalhe; zoom limitado a 10 m por pixel |
| Terreno e perfil | TIN de pontos XYZ (até 4.000 pontos) e perfil longitudinal no diálogo de projeto, com recobrimento até a geratriz superior e `null` fora do TIN — corretos, mas sem ligação com a planta |
| Exportação | IFC com `IfcProjectedCRS` (só nome) e `IfcMapConversion`; DXF e SVG da planta nas coordenadas do projeto |

## Arquitetura

```
packages/core/src/geo/         referenciais e transformações (puro, só matemática)
  crs.ts                       registro dos sistemas projetados suportados (por EPSG)
  projection.ts                Transversa de Mercator (séries de Krüger), escala e convergência
  transform.ts                 cadeia local ⇄ projetado ⇄ geográfico; estado do georreferenciamento
  webMercator.ts               esquema de ladrilhos dos serviços de mapa
packages/core/src/schema.ts    InfraSettings (escala, mapa, camadas, rótulos); verticalDatum
apps/web/src/map/              provedores de mapa e cálculo dos ladrilhos (não conhece hidráulica)
apps/web/src/infra/            camadas e controles da Planta Infra (React) + regras puras
apps/web/src/editor/renderOrigin.ts   origem de renderização das vistas
```

O domínio hidráulico não conhece o mapa: guarda apenas o identificador da fonte escolhida (`project.infra.basemap.sourceId`). O módulo `map/` não conhece tubos: recebe uma janela em coordenadas locais e a cadeia de transformações, e devolve ladrilhos posicionados.

### Referenciais

```
local do modelo (x, y, z; m)
  ⇄ projetado do projeto (E, N; m)   translação + rotação da georreferência = IfcMapConversion
  ⇄ geográfico no datum do sistema   Transversa de Mercator (Krüger, ordem n⁴)
  ⇄ geográfico do mapa (WGS 84)      transformação de datum declarada no registro
  ⇄ ladrilho Web Mercator            só para pedir e posicionar imagens
```

- **Medidas de engenharia** (comprimentos, cotas, deflexões, recobrimentos) são sempre tomadas no referencial local. Nada é medido em pixels nem em Web Mercator.
- **Sistemas suportados para o mapa:** SIRGAS 2000 / UTM (EPSG 31965–31985, 5396, 6210, 6211) e WGS 84 / UTM (32601–32660, 32701–32760). Nome, meridiano central, falso norte e elipsoide foram conferidos com o banco EPSG do PROJ 9.8.1. SAD69, Córrego Alegre, sistemas geográficos e outras projeções **não** são aproximados: a georreferência continua valendo para o IFC e a planta informa que não há transformação para o mapa.
- **Datum:** SIRGAS 2000 → WGS 84 é a transformação nula do banco EPSG (código 15485), com exatidão declarada de 1 m. O registro guarda esse valor (`datumToMapAccuracy`) e a interface o mostra.
- **Estados** (`georeferenceStatus`): `pending` (nada informado), `unsupported` (sem EPSG ou sistema fora do registro), `invalid` (origem fora do domínio do fuso) e `ready`. Nenhum EPSG, fuso, coordenada ou altitude é preenchido automaticamente; o nome do sistema só é completado a partir do código que o usuário digitou.
- **Altimetria:** `orthogonalHeight` é a altitude do ponto de cota local Z = 0; `verticalDatum` nomeia a referência altimétrica (ex.: Imbituba) e pode ficar não informada. Imagem de satélite não fornece cotas.
- **Limitação declarada:** a conversão local → projetado usa escala 1 (a mesma do `IfcMapConversion` exportado). O diálogo de georreferência mostra o fator de escala da projeção e a convergência meridiana na origem, para que o projetista saiba quanto a quadrícula difere do terreno (até cerca de 1 m por km na borda de um fuso). O fator de escala combinado como parâmetro do projeto está nas etapas seguintes.

### Tolerâncias

| Verificação | Tolerância | Justificativa |
| --- | --- | --- |
| Projeção direta e inversa contra o PROJ (13 pontos de controle, 8 sistemas) | 0,01 mm em E/N; 1e-10 grau | Erro de truncamento das séries de ordem n⁴ dentro de um fuso |
| Ida e volta local ⇄ projetado ⇄ geográfico (`GEO_ROUNDTRIP_TOLERANCE`) | 0,1 mm | Cinco vezes menor que a tolerância de acoplamento das portas (0,5 mm): converter um ponto nunca desfaz uma conexão. O erro medido é inferior a 1 µm em uma rede de 20 km |
| Colocação afim de cada ladrilho (níveis 10 a 14) | 0,5 pixel da imagem | Abaixo da resolução da própria imagem; medido no pior caso (borda do fuso, quadrícula girada) |
| Ponto de controle do modelo × mapa, no navegador | 1 pixel de tela | Limite do que é visível; verificado após zoom, deslocamento e reabertura |

A exatidão do **conjunto** mapa + modelo é limitada pela imagem (10 m por pixel na fonte padrão) e pela transformação de datum (1 m), não pelas contas. O mapa é referência espacial, não levantamento.

### Georreferência pelo mapa

O estado "georreferenciamento pendente" da Planta Infra abre um mapa navegável (`infra/GeoPicker.tsx`), nos temas satélite e ruas. O usuário vai até a área do projeto (arraste, roda do mouse ou latitude; longitude), escolhe o fuso e clica no ponto que será a origem local (0; 0). As coordenadas E/N desse ponto são calculadas pela projeção do fuso e gravadas como georreferência, com rotação nula; a planta abre nesse ponto, na mesma ampliação, com o mapa ao fundo, pronta para modelar.

- **Fuso inicial: SIRGAS 2000 / UTM 21S (EPSG:31981)**, por decisão do responsável pelo projeto (2026-11-18); o 22S e os demais fusos do território brasileiro (18S a 25S) são opções. É só a opção pré-selecionada: nada é gravado antes de o usuário confirmar um ponto.
- Um ponto a mais de 3,5° do meridiano central do fuso escolhido não pode ser confirmado: o editor informa o fuso a que ele pertence.
- A altitude da origem e a referência altimétrica **não** vêm do mapa: ficam como estavam (ou não informadas).
- A resolução do clique é a de um pixel do mapa (≈ 0,3 m no maior nível do tema de ruas; a imagem de satélite tem 10 m). Para amarrar o projeto a um levantamento, as coordenadas E/N do marco continuam sendo informadas no formulário (botão "Informar coordenadas…").

### Mapa de fundo

Fontes embutidas: satélite e ruas.

**Ruas — OpenStreetMap** (`https://tile.openstreetmap.org/{z}/{x}/{y}.png`, até o nível 19, dados sob ODbL). Conferido em 2026-11-18 na política de uso dos ladrilhos (<https://operations.osmfoundation.org/policies/tiles/>): atribuição visível obrigatória; proibidos o download em massa, o pré-carregamento e o uso sem conexão; sem garantia de disponibilidade, com bloqueio possível em caso de uso intenso. Usado só para exibição na tela; não entra em exportações.

**Satélite — Sentinel-2 cloudless 2016, da EOX** (camada `s2cloudless_3857` do serviço WMTS `tiles.maps.eox.at`), licença **CC BY 4.0**, sem chave. Conferido em 2026-11-18 no documento de capacidades do serviço (licença e atribuição da camada) e em <https://maps.eox.at/> (condições do serviço).

| Aspecto | Situação |
| --- | --- |
| Atribuição | "EOxCloudless https://cloudless.eox.at by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2016)", sempre visível com a imagem, com a licença, a data e a resolução |
| Resolução | ≈ 10 m (bandas visíveis do Sentinel-2). Ladrilhos reais até o nível 14; acima disso a planta apenas amplia a imagem e avisa |
| Impressão e exportação | Permitidas pela CC BY 4.0, com a atribuição. Nesta entrega a planta é exportada **sem** a imagem |
| Cache e uso sem conexão | Não previsto pelo serviço: nada é pré-carregado nem guardado |
| Limites | Serviço de demonstração, sem garantia de disponibilidade e com limite de requisições |

**Fonte personalizada (alta resolução).** As fontes embutidas não passam de 10 m por pixel em imagem de satélite: os serviços de alta resolução (Esri, Google, Bing, Mapbox, MapTiler) exigem conta ou chave, que não podem estar no repositório. Para usá-los — ou para usar ortofotos servidas pela própria empresa — o usuário cadastra em *Camadas › Fonte de mapa própria* (ou no seletor de georreferência) o endereço de ladrilhos em Web Mercator (`https`, com `{z}`, `{x}` e `{y}`), a atribuição exigida e o nível máximo de zoom. O endereço, que pode conter a chave do usuário, fica só no `localStorage` do navegador (`map/customSource.ts`): o projeto guarda apenas `sourceId: "custom"`, e em outro navegador a planta avisa que a fonte não está cadastrada. Como o editor não conhece a licença dessa fonte, ela nunca entra em exportações; cabe ao usuário cumprir os termos do serviço.

**Atalho Esri World Imagery.** O mesmo formulário tem um campo só para a chave de API da ArcGIS Location Platform (conta gratuita, com cota mensal de ladrilhos — conferir o valor vigente em <https://location.arcgis.com/pricing/>). Com a chave, `esriWorldImagerySource` monta o endereço documentado pela Esri (`https://ibasemaps-api.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}?token=…`, ordem nível/linha/coluna), a atribuição ("Powered by Esri — Esri, Maxar, Earthstar Geographics, and the GIS User Community") e o nível máximo 19. A chave é do usuário e segue a regra da fonte personalizada: só no navegador, nunca no projeto, no repositório ou em exportações. Limitações: não foi testado com uma chave real nesta entrega; em áreas rurais a Esri pode não ter imagem nos níveis 18–19 (devolve um ladrilho de aviso) — nesse caso, reduzir o nível máximo no formulário.

No seletor de georreferência, ampliar além da resolução da fonte mostra um aviso e sugere o tema Ruas ou uma fonte própria.

Fontes avaliadas e **não** adotadas: camadas EOX de 2018 em diante (CC BY-NC-SA, incompatível com uso profissional); camada EOX de 2017 (CC BY 4.0, mas respondeu ladrilhos vazios sobre o Brasil na conferência); Esri World Imagery (regida pelo contrato da Esri, exige conta e proíbe exportar ladrilhos); NASA GIBS (dados abertos, mas produtos diários com nuvens, não um mosaico); mosaicos do INPE (serviço WMS aberto, licença e atribuição não confirmadas).

Funcionamento: os ladrilhos são elementos `<image>` do SVG, posicionados por uma transformação afim por ladrilho calculada pela cadeia de referenciais. Só a região visível é pedida (no máximo 64 ladrilhos), depois que a vista assenta por 140 ms; ao sair da vista, o elemento é removido e o navegador cancela a requisição. Falha de rede, serviço fora do ar ou navegador sem conexão apenas deixam o fundo sem imagem, com o estado indicado e a opção de tentar de novo — a edição nunca depende do mapa.

### Planta Infra

- **Própria do ambiente:** aparece quando `discipline` é `infra`. Tem escala de documentação (`infra.drawingScale`, 1:200 a 1:10.000), camadas e rótulos independentes da planta do MEP (`drawingScale`).
- **Zoom × escala:** a barra de escala e a indicação "vista ≈ 1:n" referem-se ao zoom de navegação; a escala de documentação define o tamanho de textos, cotas e traços na impressão.
- **Camadas:** rede, equipamentos, terreno (limite, linhas de quebra, curvas de nível e, se ligada, a triangulação), referências (malha de coordenadas E/N ou X/Y) e anotações. Rótulos: identificação, comprimento dos trechos e cotas (eixo, geratriz superior, terreno e recobrimento; "terreno: sem dado" sem levantamento ou fora dele).
- **Nível de detalhe:** quando a geometria real de um elemento ocuparia menos de 3 px, ele é desenhado como eixo (tubos) ou símbolo de tamanho fixo na tela (conexões e equipamentos), marcado `data-lod="symbol"` e avisado como fora de escala. As dimensões do modelo não mudam; ao aproximar volta a geometria das peças.
- **Rótulos sem sobreposição:** aceitos por prioridade (nós antes de trechos, trechos longos antes dos curtos), em pixels de tela, até 250 por vista.
- **Norte:** seta do norte da quadrícula (NQ), com a convergência meridiana informada; sem georreferência, "N ?".
- **Modelagem:** as mesmas ferramentas, operações e regras de catálogo do MEP, pela mesma store. O mapa é só fundo.

### Origem de renderização

O SVG e a placa de vídeo trabalham em precisão simples. As vistas desenham em relação a `renderOrigin` (estado de sessão, múltiplo de 1.000 m), reposicionada quando o ponto observado se afasta mais de 5 km — onde o passo da precisão simples é de 0,5 mm. Na planta, cada elemento tem ainda uma âncora própria e os caminhos são escritos em relação a ela. No 3D, o conteúdo do modelo fica em um grupo transladado, a câmera acompanha a troca de origem e os raios de captura voltam às coordenadas do projeto antes de chegar às regras. O projeto, os identificadores, a conectividade e as exportações nunca passam pela origem de renderização.

## Superfície do terreno

Decisão correspondente: [ADR-040](DECISIONS.md). Estrutura de dados: `docs/DOMAIN_MODEL.md`, seção Terreno.

```
packages/core/src/terrain/     núcleo puro (sem interface, sem rede)
  polygon.ts                   área de recorte (contorno e furos), validação e GeoJSON
  delaunay.ts                  triangulação de Delaunay com restrições (limite e linhas de quebra)
  surface.ts                   construção da superfície; cota, declividade e estatísticas
  dem.ts                       raster de elevação, posição pela georreferência, pontos da área
  survey.ts                    linhas de quebra, recorte de levantamento, estrutura de intercâmbio
  contours.ts, profile.ts      curvas de nível e corte longitudinal
apps/web/src/terrain/          fontes, arquivos, processamento e interface
  elevationProviders.ts        registro das fontes de elevação em ladrilhos
  elevationTiles.ts            ladrilhos da área, download com progresso e cancelamento, cache da sessão
  geotiff.ts                   leitor de GeoTIFF (sem dependências)
  terrainJob.ts, terrainWorker.ts, terrainRunner.ts   geração fora do fluxo da interface
  terrainActions.ts, terrainStore.ts                  casos de uso e estado de sessão
  TerrainPanel.tsx, TerrainLayers.tsx, TerrainProfilePanel.tsx, TerrainDisplayControls.tsx
apps/web/src/viewport/TerrainSurface.tsx   superfície no modelo 3D
```

### Fluxo

1. **Área** (Modelagem › Terreno › Superfície do terreno): o contorno é desenhado na Planta Infra clicando os vértices (fecha no primeiro ponto ou com Enter), com furos opcionais, ou importado de um GeoJSON (longitude e latitude, WGS 84 — um arquivo em coordenadas projetadas é recusado). Contornos que se cruzam e furos fora do contorno são recusados com o motivo. A área em edição é estado de sessão; o limite da superfície gerada é que vai para o projeto, e pode ser retomado como área.
2. **Fonte de elevação**: DEM online, GeoTIFF ou levantamento.
3. **Geração** em um Web Worker, com etapas, andamento dos ladrilhos e cancelamento. O resultado é a superfície gravada no projeto (com desfazer) ou uma mensagem de erro — nunca uma superfície parcial.

### Fontes de elevação

| Fonte | Acesso | O que a documentação declara | Conferido em |
| --- | --- | --- | --- |
| **Terrain Tiles (Mapzen/Tilezen)**, dados abertos na AWS | `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png`, sem chave ("No AWS account required") | Ladrilhos de 256 px, níveis 0 a 15, codificação Terrarium `(R × 256 + G + B ÷ 256) − 32768` m. Em terra, fora das regiões com levantamento regional, o dado é o SRTM (30 m nominais); no nível 15 a maior parte dos valores é SRTM do nível 12 sobreamostrado. **Não declara** referência altimétrica nem exatidão | 2026-11-19, em <https://registry.opendata.aws/terrain-tiles/> e <https://github.com/tilezen/joerd/tree/master/docs> |
| **Mapbox Terrain-RGB v1** (Raster Tiles API) | `https://api.mapbox.com/v4/mapbox.terrain-rgb/{z}/{x}/{y}.pngraw?access_token=…`, com a chave pública da conta do usuário | Codificação `−10000 + (R × 256² + G × 256 + B) × 0,1` m; dado até o nível 15 (256 px); sem atualizações desde 2021-12-01; fontes e **referências altimétricas variam com o local** (NAVD 88, EGM 96, Ordnance Datum Newlyn…). Não declara exatidão nem a resolução de origem por local | 2026-11-19, em <https://docs.mapbox.com/data/tilesets/reference/mapbox-terrain-rgb-v1/> |
| **GeoTIFF do usuário** | Arquivo local | O que o arquivo declara nas chaves GeoTIFF | — |

- **Mapbox Terrain-DEM v1** (`mapbox.mapbox-terrain-dem-v1`, sucessor do Terrain-RGB, mesma codificação): a documentação da Mapbox diz que o conjunto só está disponível pelos SDKs dela, não pela Raster Tiles API. Por isso o padrão é o Terrain-RGB; o identificador do conjunto é um campo que o usuário pode trocar se a conta dele der esse acesso. **Não foi testado com uma chave real** (o repositório não tem credenciais): o caminho Mapbox está coberto por teste com o serviço simulado (URL, codificação, chave recusada).
- **Chave de acesso**: fica só no navegador (`localStorage`, `hydrobim.terrain.mapbox`), nunca no projeto, no arquivo ou em exportações; o cache de ladrilhos não a usa como identificador.
- **Atribuição** da fonte é gravada com a superfície (`source.attribution`) e mostrada no painel. O uso dos dados segue os termos de cada serviço; cabe ao usuário cumpri-los.

### GeoTIFF

Leitor próprio, sem dependências: TIFF clássico, faixas ou blocos, sem compressão, Deflate ou LZW, preditor horizontal ou de ponto flutuante, uma banda, amostras inteiras de 8/16/32 bits ou reais de 32/64 bits, ordem de bytes direta ou invertida. Recusados com o motivo: BigTIFF, mais de uma banda, outras compressões, raster girado, mais de 36 milhões de células, cotas em unidade diferente do metro.

- **Sistema de referência**: lido das chaves GeoTIFF (código EPSG). Aceitos o sistema do projeto, outro fuso UTM do registro, Web Mercator e os geográficos WGS 84 (EPSG:4326) e SIRGAS 2000 (EPSG:4674). Sem código EPSG, ou em outro sistema, o arquivo é recusado: a posição de um raster nunca é presumida.
- **Célula e nó**: com `PixelIsArea` (o padrão) o nó fica no centro da célula; com `PixelIsPoint`, no ponto de amarração.
- **Sem dado**: o valor `GDAL_NODATA` e os valores não finitos viram lacunas.
- **Referência altimétrica**: a das chaves verticais do arquivo, quando existem; caso contrário, não informada.

### Do raster à superfície

- **Posição**: nó do raster → sistema de origem → geográfico → local, pela mesma cadeia de referenciais do mapa (`rasterFrame`). Exige o projeto georreferenciado.
- **Cota local** = altitude do raster − `georeference.orthogonalHeight` (a altitude do ponto de cota local Z = 0). Nenhuma conversão de datum vertical é aplicada: se a referência da fonte difere da do projeto, ou não é declarada, a interface avisa.
- **Vértices** = nós do raster dentro da área. Com muitas amostras, usa-se uma a cada *n* (GeoTIFF) ou um nível de ladrilho mais grosso (DEM online); as demais não são usadas e nenhuma é interpolada. O limite de 25.000 vértices é o do arquivo do projeto.
- **Limite**: os lados do contorno são adensados no espaçamento das amostras e cotados por interpolação bilinear dentro da célula (a única interpolação do processo). Se o raster não tem dado em um ponto do limite, a geração é recusada.
- **Lacunas**: nó sem dado não vira vértice, e os triângulos sobre a lacuna são removidos — a superfície fica aberta ali.
- **Resolução ≠ exatidão**: `source.resolution` é o espaçamento real das amostras usadas; `source.verticalAccuracy` só existe quando declarada. Acima da resolução nominal do dado de origem, o painel avisa que o serviço entrega valores sobreamostrados ("mais vértices, nenhum detalhe real a mais") e esses níveis não são o padrão.

### Levantamento topográfico

Pontos "X Y Z" e, opcionalmente, linhas de quebra (blocos de "X Y Z" separados por linha em branco), em coordenadas locais ou em E, N e altitude do sistema do projeto. O levantamento **substitui** a superfície vinda de DEM (a troca pode ser desfeita). Com recorte pela área, o limite é cotado pela própria triangulação do levantamento (interseção exata do contorno com as arestas do TIN); um contorno que sai da região levantada é recusado. A exatidão altimétrica é a informada pelo responsável — ou fica não informada.

### Consulta e visualização

| Recurso | Como funciona |
| --- | --- |
| Cota e declividade | Sob o cursor, na barra da Planta Infra, e ponto fixado por **Consultar cota**. Fora da superfície: "sem dado" — nada é extrapolado |
| Curvas de nível | Interseção exata do plano horizontal com os triângulos; intervalo configurável de 0,1 m a 100 m (sugerido pelo desnível; intervalos que dariam mais de 400 curvas ficam desabilitados), mestras a cada cinco. Um intervalo mais fino que a exatidão dos dados não acrescenta informação real. **Suavizar curvas** (desligado por padrão) arredonda só o desenho, na planta e no 3D, por média gaussiana ao longo da curva com alcance de alguns lados da malha (remove os degraus que a curva faz ao cruzar a triangulação célula a célula; pontas no limite ficam fixas; anéis pequenos não encolhem visivelmente): a superfície, as cotas e os cortes não mudam, e a curva suavizada deixa de passar exatamente pelas interseções com a triangulação |
| Corte longitudinal | Poligonal traçada na planta; uma estaca em cada aresta atravessada; trechos fora da superfície ficam sem cota. Gráfico com escala real 1:1 ou exagero vertical indicado; exportação em CSV |
| Modelo 3D | `BufferGeometry` com a normal de cada face (um TIN é feito de faces planas; normais suavizadas esconderiam as linhas de quebra), cor por altitude, por classes de declividade ou lisa, curvas de nível e arestas da triangulação |
| Escala vertical | **1:1 por padrão** (terreno natural, escala real). O exagero (2× a 10×) estica só o desenho do terreno no 3D, com aviso de que a rede deixa de coincidir com ele; "Terreno natural 1:1" volta à escala real |
| Origem de renderização | A malha é desenhada em relação ao centro da superfície, dentro do grupo que já aplica a origem de renderização do modelo: coordenadas UTM não perdem precisão na placa de vídeo |

As opções de visualização (cor, curvas, intervalo, triangulação, escala vertical) são estado de sessão: não alteram a superfície, o projeto nem as exportações.

### Assentamento por recobrimento

Na ferramenta Tubulação, no ambiente Infra, o grupo **Assentamento no terreno** (aba Ferramenta do painel direito) liga "Seguir o terreno pelo recobrimento" e recebe o recobrimento em metros.

- **Regra** (`terrain/cover.ts`): em cada ponto livre clicado na Planta Infra, cota do eixo = cota do terreno − recobrimento − meio diâmetro externo da especificação ativa. O recobrimento é medido até a geratriz superior externa, como no perfil e nos rótulos da planta.
- **O valor é do projetista.** O editor não traz mínimos de norma; o valor inicial (0,80 m) é só um ponto de partida.
- **Portas e tubos existentes mantêm a própria cota**: é neles que a rede se conecta. A cota pelo terreno vale para pontos livres.
- **Fora da superfície o ponto é recusado**: não há cota de terreno a usar, e nenhuma é presumida.
- **O tubo é reto entre os pontos; o terreno não.** Ao criar o trecho, o editor confere o recobrimento em cada aresta da triangulação atravessada e informa o menor e o maior valor. Se o menor ficar abaixo do definido (o terreno afunda ou o tubo corta uma elevação entre os pontos), a mensagem diz a que distância do início — a correção é um ponto intermediário ou um trecho mais fundo.
- **As regras de modelagem não mudam**: a mudança de direção vertical em cada vértice continua exigindo joelho de catálogo ou deflexão admitida na junta. Em relevo acidentado, com "Somente peças de catálogo" ligado, o núcleo recusa o trecho e explica o motivo.
- **Limites**: vale para os cliques na Planta Infra, não para a entrada por coordenadas, para o trecho por valores nem para o modelo 3D. Trechos já criados não são reassentados quando o terreno ou o recobrimento mudam.

### Equipamentos sobre o terreno

Nas ferramentas Bomba e Reservatório, o grupo **Assentamento no terreno** (aba Ferramenta) traz "Assentar sobre o terreno" — ligado por padrão quando o projeto tem superfície — e a "Altura sobre o terreno" (m, padrão 0; negativa = abaixo).

- **Regra** (`equipmentGroundElevation` na store): cota de referência do elemento (base do reservatório; eixo de sucção da bomba, que na representação genérica não tem base) = terreno no (x, y) clicado + altura, arredondada ao milímetro. Vale na planta e no 3D; nas portas livres o equipamento continua acoplado na cota da porta.
- **No 3D** o cursor é capturado onde o raio atinge a superfície (`terrainRayHit`, no núcleo), com a captura "Terreno"; com exagero vertical o raio é testado contra a superfície desenhada, mas a cota usada é a real.
- **Fora da superfície** não há cota de terreno: vale a do plano de trabalho, e a mensagem diz isso.
- **Depois de criado**, a elevação continua editável em Propriedades (como a de qualquer elemento). Bomba e reservatório mostram a cota do terreno sob a origem e o botão **Assentar no terreno**, que leva a cota de referência a ela.

### Transparência da superfície

Visualizar › Terreno › **Transparência (3D)**, de 0 a 90 % (40 % por padrão). A superfície translúcida não grava profundidade, para que a rede enterrada apareça através dela; com 0 % ela volta a encobrir o que está abaixo. É opção de visualização da sessão.

### Visibilidade da superfície

O grupo Visualizar › **Terreno (planta e 3D)** aparece nos dois ambientes. **No 3D** mostra ou oculta a superfície no modelo 3D (ligado por padrão, MEP e Infra); oculta, ela nem é montada (sem malha, curvas nem download do mapa). **Na planta** existe só no MEP (desligado por padrão) e desenha na planta o limite, as curvas de nível e a triangulação; no Infra a planta segue a camada Terreno do ambiente. São opções de visualização da sessão: não entram no projeto, no histórico nem nas exportações.

### Mapa sobre o terreno (modelo 3D)

Visualizar › Terreno › **Superfície (3D)** oferece, além de altitude, declividade e lisa, as fontes de mapa do ambiente Infra (ruas, satélite e a fonte própria): a imagem é estendida sobre a superfície e acompanha o relevo.

- **Posição**: cada vértice da malha recebe a sua posição na imagem pela mesma cadeia de referenciais que posiciona o mapa na planta (local → geográfico → ladrilho). Exige o projeto georreferenciado; sem isso a opção informa o motivo e a superfície segue com a cor escolhida.
- **Ladrilhos**: um mosaico só da área da superfície, com cerca de 2.048 px de lado e no máximo 36 ladrilhos; nada é pré-carregado nem guardado.
- **A imagem é só referência**: nenhuma cota vem dela. O relevo, as curvas de nível e o recobrimento continuam sendo os da superfície. Imagem de satélite de 10 m ampliada sobre uma área pequena fica borrada, e a interface avisa ("imagem ampliada além da resolução da fonte").
- **Atribuição** da fonte sempre visível sobre o 3D enquanto a imagem está à mostra.
- **Falhas**: serviço fora do ar, ou que não permita o uso das imagens entre origens (CORS, exigido pelo navegador para levar a imagem à placa de vídeo), deixam a superfície com a cor escolhida e uma mensagem.
- Conferido em 2026-11-19 com os serviços reais das duas fontes embutidas (ruas do OpenStreetMap e satélite da EOX); a fonte própria depende de o serviço do usuário enviar os cabeçalhos CORS.
### Cache, falhas e desempenho

- **Cache**: os ladrilhos decodificados ficam em memória durante a sessão (96 ladrilhos): trocar a resolução ou ajustar a área não refaz os pedidos. Nada é gravado em disco nem pré-carregado, e uma busca pede no máximo 36 ladrilhos. O GeoTIFF e os arquivos do levantamento ficam em memória até a página ser fechada.
- **Falhas**: serviço fora do ar, sem conexão, chave recusada, área fora da cobertura e arquivo ilegível terminam em mensagem, sem superfície. Uma busca cancelada não deixa resíduo.
- **Tolerâncias e medidas** (Vitest):

| Verificação | Resultado exigido |
| --- | --- |
| Posição do raster em ladrilhos sobre o projeto (relevo sintético, nível 13) | cota conferida a 0,05 m em pontos quaisquer; um deslocamento de um pixel daria 0,7 m |
| GeoTIFF escrito pela libtiff (LZW, real de 32 bits; Deflate, inteiro) | valores idênticos, célula a célula |
| Triangulação de 20.000 pontos e 2.000 consultas de cota | meta 1 s e 0,1 s (limites do teste: 8 s e 1 s) |
| Área da superfície × área do polígono (com furo) | 1e-6 m² em coordenadas inteiras; 0,1 m² com contorno arredondado a 0,1 mm |

### Limitações declaradas

- Uma superfície por projeto; sem fusão de DEM com levantamento em regiões diferentes.
- Curvas de nível e corte são vistas: ainda não entram no DXF/SVG da planta nem viram anotações.
- LandXML ainda não é exportado (a estrutura de dados está pronta: `terrainExchange`). O IFC leva o terreno e a terraplenagem (`docs/IFC_MAPPING.md`); o DXF do modelo 3D leva a malha do terreno natural.
- O perfil do terreno e o perfil da rede (Análise › Perfil longitudinal) são painéis separados.
- Abrir o Modelo 3D com um tubo selecionado emite no console um aviso do React ("Attempted to synchronously unmount a root…") vindo das alças do tubo; não é causado pelo terreno e não afeta o resultado, mas ainda não foi corrigido.
- O caminho Mapbox não foi exercitado com uma chave real; a fonte aberta (Terrain Tiles) não foi exercitada contra o serviço real nos testes automatizados, que interceptam a rede.

## Edição do terreno e terraplenagem

Decisão correspondente: [ADR-045](DECISIONS.md). Estrutura de dados: `docs/DOMAIN_MODEL.md`, seções Terreno e Terraplenagem. Faixa: Modelagem › Terraplenagem › **Editar Terreno | Criar Platô | Corte/Aterro | Volumes** (ambiente Infra, com superfície no projeto).

```
packages/core/src/terrain/
  edit.ts        edição da superfície: pontos, cota, limite, triangulação, original
  grading.ts     terreno projetado: platôs, taludes e remalhamento local
  volumes.ts     integração entre as duas superfícies, sólidos e quantidades
  earthworks.ts  operações do projeto (platôs, parâmetros) e quadro de quantidades
apps/web/src/terrain/
  earthworkStore.ts        estado de sessão e casos de uso (gravam pela store do editor)
  EarthworkPanel.tsx       painel com as quatro abas, sobre a Planta Infra
  EarthworkLayers.tsx      platôs, linha de encontro, corte/aterro e pontos na planta
  EarthworkProperties.tsx  superfície e platô no painel de propriedades
  EarthworkNavRows.tsx     superfície e platôs no navegador do projeto
packages/ifc/src/terrainExport.ts   terreno, cortes e aterros no IFC
```

### Superfície como elemento

A superfície tem identificador persistente, nome e identificação (`tag`). Selecionada (Editar Terreno, navegador do projeto › Referências, ou "Selecionar na planta"), mostra no painel de propriedades: nome e identificação editáveis, área em planta e da superfície, cotas mínima e máxima, vértices e triângulos, declividade média, origem dos dados (tipo, fonte, conjunto, data, resolução e exatidão — "não informado" quando a fonte não declara), sistema horizontal, referência altimétrica e os cantos da extensão (E/N com georreferência, X/Y sem ela).

### Editar Terreno

| Operação | Como funciona |
| --- | --- |
| Adicionar ponto | Clique a posição na planta; o painel mostra a cota da superfície no local e pede a cota do ponto. Dentro do limite, quando há limite; sem limite, um ponto de fora amplia a superfície |
| Editar ponto | Clique um ponto (todos aparecem na planta durante a edição). X, Y e Z no painel; **Mover na planta** leva o ponto ao próximo clique, mantendo a cota |
| Excluir ponto | A triangulação é refeita em volta; um vértice do limite ou de uma linha de quebra sai deles também |
| Redesenhar limite | Anel desenhado dentro da superfície, cotado pela triangulação atual (interseção exata com as arestas); o que fica de fora sai. Um limite que ultrapassa a região com dado é recusado |
| Regenerar triangulação | Refaz a malha com os pontos, o limite e as linhas de quebra atuais |
| Restaurar original | Volta à superfície como foi importada |

- **Mesmo construtor da importação**: mudar posição ou limite refaz a triangulação (Delaunay com restrições); trocar só a cota não muda a malha. Nenhuma cota é interpolada ou suavizada.
- **Original preservada**: na primeira edição a malha importada é guardada no projeto (`terrain.original`). A vista **Original** (aba Corte/Aterro) a mostra na planta e no 3D para comparação. Importar ou gerar outra superfície descarta a anterior e a original dela (com desfazer).
- **Lacunas do DEM continuam abertas**; um ponto cotado posto em uma lacuna a preenche só em volta dele.
- **Custo**: cada edição de posição refaz a triangulação inteira (meta de 1 s para 20.000 pontos); a edição é confirmada operação a operação, com desfazer.
- **Tamanho do arquivo**: a original dobra o espaço do terreno no JSON enquanto a superfície estiver editada.

### Criar Platô

1. Informe a **cota de implantação** (Z local) e os **taludes de corte e de aterro** em H:V (metros na horizontal por metro na vertical). A cota começa vazia — é dado do projeto; os taludes começam em 1 e 1,5 só como ponto de partida: a inclinação estável depende do solo e é do projetista.
2. **Desenhar perímetro**: clique os vértices sobre o terreno e feche no primeiro ponto (ou Enter).
3. O terreno projetado, a linha de encontro dos taludes com o terreno e os volumes são gerados e mostrados na planta e no 3D.

O platô é paramétrico: mudar a cota, os taludes ou o perímetro (Redesenhar perímetro) regenera tudo. Vários platôs são aplicados **em sequência** — o segundo encontra o terreno já modificado pelo primeiro (um aterro pode apoiar no talude do vizinho). A superfície natural nunca é alterada: o projeto guarda só os parâmetros.

**Geometria** (`grading.ts`):

- De cada ponto do perímetro sai, na direção normal ao lado, uma linha de maior declive do talude — subindo no corte, descendo no aterro. Ela termina na **primeira** interseção com o terreno existente, calculada exatamente, trecho a trecho, sobre os triângulos atravessados. Não é deslocamento de vértices nem amostragem em grade.
- O perímetro é amostrado onde cruza arestas do terreno e onde o terreno cruza a cota do platô: ali o talude tem altura zero e muda de corte para aterro.
- **Cantos salientes**: as linhas abrem em leque (7,5° entre elas) — o talude é um trecho de cone, a única forma de manter a inclinação constante em volta de um canto. O leque é uma aproximação poligonal do cone (diferença de volume da ordem de 0,3 % da parcela do canto).
- **Cantos reentrantes**: os taludes dos dois lados se encontram em uma aresta sobre a bissetriz.
- **Remalhamento local**: os triângulos tocados saem e a região é triangulada de novo com o perímetro, as linhas de talude e a linha de encontro como arestas obrigatórias. A linha de encontro ganha um vértice, na cota do terreno, em cada aresta atravessada — as duas superfícies coincidem exatamente ao longo dela. Fora da região a malha é idêntica à do terreno. A área refeita é conferida com a removida.

**Recusas** (com o motivo, sem resultado parcial): perímetro fora da superfície ou que se cruza; talude que não encontra o terreno dentro da superfície; platô ou talude sobre a borda ou sobre uma lacuna sem dado; reentrância estreita demais (os taludes de lados opostos se encontram antes de chegar ao terreno); linhas de talude que se cruzam.

### Corte/Aterro

Alterna a superfície à mostra na planta e no 3D: **Natural**, **Projetado**, **Comparação** (projetado com o corte em vermelho e o aterro em azul, com legenda) e, se a superfície foi editada, **Original**. As curvas de nível e a triangulação são as da superfície à mostra. Na planta, a linha tracejada em volta de cada platô é o encontro dos taludes com o terreno (crista do corte ou pé do aterro). É opção de visualização da sessão.

### Volumes

**Integração** (`volumes.ts`): cada triângulo do terreno projetado é recortado pelos triângulos do terreno natural que ele cobre; em cada pedaço as duas superfícies são planos e a diferença de cota é linear. O pedaço é dividido pela linha em que a diferença é zero — de um lado corte, do outro aterro — e o volume de cada parte é a área em planta vezes a média das diferenças nos vértices, exato para faces planas. Não há grade de amostragem: onde as superfícies se cruzam, corte e aterro são separados na linha de cruzamento, e nenhum volume sai negativo.

**Convenções** — cada volume está em um estado, e estados diferentes não são somados sem conversão:

| Quantidade | Estado | Cálculo |
| --- | --- | --- |
| Corte | in situ | integração geométrica |
| Aterro | compactado | integração geométrica |
| Escavado solto | solto | corte × (1 + empolamento ÷ 100) |
| Aproveitável | in situ | corte × aproveitamento ÷ 100 |
| Aterro com material do corte | compactado | aproveitável × fator de conversão |
| Saldo | compactado | aterro com material do corte − aterro (positivo = sobra; negativo = falta) |
| Empréstimo | compactado | falta de aterro, a cobrir com material de fora |
| Empréstimo na jazida | in situ | empréstimo ÷ fator (supõe o mesmo fator do corte para o material de empréstimo) |
| Excedente (bota-fora) | in situ | corte não aproveitável + sobra ÷ fator |
| Excedente a transportar | solto | excedente × (1 + empolamento ÷ 100) |

- **Fator de conversão** = m³ de aterro **compactado** obtidos de 1 m³ de corte **in situ** (ex.: 0,90). Não é o grau de compactação.
- **Os três parâmetros são do projetista** e começam não informados: sem eles, corte e aterro geométricos aparecem e o restante fica pendente ("—"). O editor não traz valores de solo.
- **Quadro** por platô e total do projeto, com exportação CSV. O volume de cada platô é medido sobre a região dele (platô e taludes) contra o terreno natural; o total é a soma.

### Verificação

| Caso (Vitest, `earthworks.test.ts`) | Referência | Tolerância |
| --- | --- | --- |
| Aterro de 2 m, 20 × 20 m, talude 1,5, terreno plano | a²h + 4·a·r·h/2 + π r² h/3 = 1.058,85 m³ | 0,1 m³ |
| Corte de 3 m, talude 1, terreno plano | 1.588,27 m³ | 0,1 m³ |
| Mesmo aterro fora do alinhamento da malha | idem | 0,1 m³ |
| Platô a meia encosta em plano inclinado, taludes iguais | corte = aterro (antissimetria) e integração independente em grade de 5 cm | 0,5 % |
| Plano inclinado nas duas direções, quadrilátero, taludes 1 e 2 | integração independente em grade de 5 cm | 1 % |
| Platô em L (canto reentrante) em terreno plano | h·[A + P r/2 + (5π/2 − 2) r²/6] = 1.727,56 m³ | 0,2 m³ |
| Relevo irregular | volumes positivos, área da superfície conservada, natural intacto fora da linha de encontro, volume dos sólidos = volume integrado | — |

No navegador (`tests/e2e/earthworks.spec.ts`): criação do platô pelo desenho, volumes conferidos com as mesmas fórmulas, mudança de cota de aterro para corte, parâmetros do material, comparação na planta e no 3D, edição de pontos e de limite, original e desfazer.

### Limitações declaradas

- Reentrâncias estreitas (pátios, formas em U cujos taludes se encontram antes do terreno) são recusadas; divida o platô.
- Platôs são horizontais; sem bermas, sem taludes variáveis por lado, sem platôs inclinados.
- O perímetro é alterado redesenhando-o (não há arraste de vértices).
- O assentamento por recobrimento, o assentamento de equipamentos, o perfil longitudinal, o percurso e o DXF usam o terreno **natural**, não o projetado.
- Os sólidos de corte e de aterro podem ter lascas submilimétricas abertas em relevo irregular (o IFC informa `Closed = .F.`); os volumes do quadro vêm da integração, não do sólido.
- Não há peso, distância de transporte, distribuição de massas (Brückner) nem camadas de solo.
- Cada alteração recalcula o terreno projetado de todos os platôs; o resultado é guardado enquanto o terreno e os platôs não mudam. Não foi medido com superfícies de 25.000 vértices e dezenas de platôs.

## Persistência

| O quê | Onde | Observação |
| --- | --- | --- |
| Georreferência e referência altimétrica | `project.georeference` | Dado de engenharia |
| Escala de documentação, fonte e opacidade do mapa, camadas, rótulos | `project.infra` | Reabre a planta como foi deixada |
| Superfície do terreno (identificação, malha, limite, linhas de quebra, procedência e a malha original, depois da primeira edição) | `project.terrain` | Dado de engenharia, com desfazer |
| Platôs (perímetro, cota, taludes) e parâmetros de volume | `project.earthworks` | Dado de engenharia, com desfazer |
| Terreno projetado, taludes, linha de encontro, volumes e sólidos de corte e de aterro | Derivados | Nunca gravados |
| Zoom, centro, origem de renderização, estado do mapa, área do terreno em edição, corte, opções de visualização do terreno, superfície à mostra (natural, projetada, comparação), ponto e platô escolhidos | Estado de sessão | Não entra no arquivo |
| Chave de acesso de fonte de elevação | `localStorage` do navegador | Nunca entra no projeto |

O terreno entrou no esquema v12 e virou elemento, com a terraplenagem, no v17 (migração v16 → v17: identificador fixo, identificação vazia, nunca editado, sem platôs e sem parâmetros de volume presumidos); documentos anteriores são migrados ao abrir (v10 → v11: configuração padrão, escala da planta levada para a Planta Infra nos projetos Infra, referência altimétrica não informada; v11 → v12: terreno existente vira levantamento por pontos, sem limite informado e sem datum, exatidão ou data presumidos).

## Desempenho

Cenário reproduzível: adutora de 10 km com 2.000 trechos de 5 m (`apps/web/src/infra/infraPlan.test.ts`).

| Operação (a cada movimento da vista) | Meta | Onde é verificada |
| --- | --- | --- |
| Recorte pela janela e nível de detalhe de toda a rede | < 50 ms | Vitest (limite do teste: 250 ms) |
| Rótulos de toda a rede com controle de sobreposição | < 100 ms | Vitest (limite do teste: 500 ms) |
| Ladrilhos pedidos por vista | ≤ 64 | Vitest e E2E |

O limite de cada teste é cinco vezes a meta: o tempo medido oscila com a máquina ocupada (em uma execução com outros processos pesados o segundo caso levou 211 ms), e o teste existe para acusar regressões de ordem de grandeza. Ainda não medido: tempo de quadro no navegador com milhares de elementos em detalhe, e o modelo 3D de redes extensas (uma malha por elemento, sem instanciamento).

## Etapas seguintes

1. **Seleção e captura em redes extensas:** seleção por janela na planta, por filtros (sistema, material, DN, categoria) e de conjuntos conectados; índice espacial para captura de portas e eixos; prévia das peças afetadas antes da confirmação.
2. **Traçado contínuo:** polilinha por vértices com entrada de coordenadas E/N, distâncias, azimutes e cotas; deflexões resolvidas por curvas de catálogo ou por deflexão de junta **documentada** no catálogo (hoje nenhuma família traz esse dado — nada será presumido).
3. **Alinhamentos e estaqueamento:** alinhamento de referência como entidade distinta da tubulação; estacas; a rede só passa a existir quando conexões, dimensões e compatibilidade estiverem resolvidas.
4. **Assentamento por recobrimento:** já existe nos cliques da Planta Infra (ver Superfície do terreno); faltam a entrada por valores e o 3D, reassentar trechos existentes, pontos intermediários automáticos onde o recobrimento cai e as pendências de recobrimento na validação.
5. **Perfil como vista:** perfil longitudinal na área de trabalho, sincronizado com a seleção e a posição na planta e no 3D (hoje abre no diálogo de análises, pelo botão Perfil… ou por Análise › Perfil longitudinal).
6. **Terreno:** importação e exportação LandXML, curvas de nível e corte na documentação (DXF/SVG, anotações), mais de uma superfície por projeto, BigTIFF e rasters maiores lidos por janela.
7. **Terraplenagem:** reentrâncias estreitas, bermas e platôs inclinados, arraste dos vértices do perímetro, rede e equipamentos assentados sobre o terreno projetado, conjuntos do terreno na aba BIM / IFC e no IDS, DXF do terreno projetado, distribuição de massas.
8. **Mapa:** ortofoto georreferenciada em arquivo (GeoTIFF) fornecida pelo usuário; imagem na exportação quando a licença da fonte permitir; satélite no modelo 3D.
9. **Documentação:** prancha com carimbo, legenda, norte e malha de coordenadas; exportação em PDF; fator de escala combinado no projeto.
10. **Desempenho do 3D:** instanciamento e níveis de detalhe para milhares de elementos.
