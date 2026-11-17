# Decisões técnicas

Registro resumido das decisões de arquitetura (formato ADR). Novas decisões entram no fim, com data; decisões revistas são marcadas como substituídas, não apagadas.

## ADR-001 — Modelo paramétrico próprio; IFC como formato de intercâmbio

**Data:** 2026-11-16 · **Estado:** aceita

O editor opera sobre um modelo de domínio próprio, tipado e versionado. O IFC é produzido por uma camada de exportação. Motivo: edição rápida, regras de engenharia explícitas e independência de versões do esquema IFC.

## ADR-002 — Monorepo com npm workspaces, pacotes consumidos como código-fonte

**Estado:** aceita

`packages/*` exportam TypeScript diretamente (`exports` → `src/index.ts`); Vite e Vitest compilam sob demanda. Sem etapa de build por pacote nem ferramentas adicionais (Turborepo, Nx). Reavaliar quando houver publicação de pacotes ou tempos de build relevantes.

`packages/ifc-contracts`, sugerido inicialmente, **não foi criado**: não há código de contrato IFC antes da Fase 3 e pacotes vazios foram evitados. O mapeamento está em `docs/IFC_MAPPING.md`.

## ADR-003 — Esquema único em Zod, espelhado em Pydantic

**Estado:** aceita

`packages/core/src/schema.ts` é a fonte de verdade; os tipos TypeScript são inferidos dele. O backend replica o contrato em Pydantic e um teste valida todos os arquivos de `examples/` nos dois lados. Alternativa adiada: gerar ambos a partir de JSON Schema.

## ADR-004 — Unidades SI internas e eixo Z para cima

**Estado:** aceita

Metros e radianos em todo o domínio; conversões só na apresentação. Z para cima, como na prática de engenharia e no IFC; a câmera do Three.js é configurada com `up = (0, 0, 1)`, sem conversão de eixos entre domínio e cena.

## ADR-005 — DN separado dos diâmetros físicos; catálogo por especificação

**Estado:** aceita

`PipeSpec` armazena DN, diâmetro externo, interno e espessura. Os valores vêm de `packages/catalog`, organizados por material + norma + classe. O elemento guarda a especificação resolvida (o projeto continua legível mesmo que o catálogo mude) e o `specificationId` de origem.

## ADR-006 — Portas e validação derivadas; conectividade em grafo separado

**Estado:** aceita

Portas são calculadas a partir dos parâmetros do elemento; o estado de conexão existe apenas em `Project.connections`. Evita estados inconsistentes (porta "conectada" sem conexão, referência duplicada). Custo: recalcular portas sob demanda — irrelevante no porte atual.

## ADR-007 — Compatibilidade conservadora entre portas

**Estado:** aceita

Só se conectam portas de mesma especificação e mesmo DN, coincidentes e alinhadas. Materiais, normas ou diâmetros diferentes nunca são compatíveis por padrão: exigem redução ou peça de transição (a modelar na Fase 2). Preferiu-se recusar a esconder uma incompatibilidade.

## ADR-008 — Operações puras e projeto imutável

**Estado:** aceita

Cada operação devolve um novo `Project` ou um erro de domínio (`Result<T>`). Benefícios: operações atômicas (falha não deixa estado parcial), desfazer/refazer por instantâneos, testes simples e detecção de mudanças por identidade no React.

## ADR-009 — Geometria independente de motor gráfico

**Estado:** aceita

`packages/geometry` gera malhas (`Float32Array`) no referencial local por varredura de seções circulares ocas, sem depender de Three.js. O viewport apenas as converte em `BufferGeometry`. A mesma geometria poderá alimentar a exportação IFC por malha. Kernel BRep (OpenCascade) fica adiado até haver necessidade real (interferências, cortes), por ser uma dependência pesada.

## ADR-010 — Conexões explícitas; automatismo limitado e previsível

**Estado:** aceita

Na Fase 1 há apenas dois automatismos: conexão de portas exatamente acopladas e joelho automático ao desenhar a partir da extremidade de um tubo (com aparo do tubo). Saídas de conexões ficam presas ao eixo da porta. Roteamento e snapping avançados pertencem à Fase 2.

## ADR-011 — Interface em CSS próprio, sem biblioteca de componentes

**Estado:** aceita (reavaliar na Fase 2)

A interface usa elementos HTML nativos acessíveis (`button`, `select`, `dialog`, `label`) com folha de estilos própria e ícones `lucide-react`. Uma biblioteca de componentes ou Tailwind foi adiada para manter poucas dependências enquanto o conjunto de telas é pequeno. Reavaliar quando surgirem menus, árvores e tabelas complexas.

## ADR-012 — Persistência local atrás de `ProjectRepository`

**Estado:** aceita

Projetos em `localStorage` (JSON versionado), além de importação/exportação de arquivo. A interface do repositório é assíncrona para permitir a troca por API + PostgreSQL. Limite conhecido: cota do `localStorage` (~5 MB); o erro é tratado e o usuário é orientado a exportar o arquivo.

## ADR-013 — Interação do viewport fora do sistema de eventos do R3F

**Estado:** aceita

Um único controlador traduz eventos de ponteiro do canvas em raio → ponto/porta/elemento, usando funções puras testáveis (`editor/picking.ts`). Motivo: precedência clara entre snap de porta, restrição de eixo e plano de trabalho, e distinção simples entre clique e arrasto de câmera.

## ADR-014 — IFC 4.3 como alvo; IFC 4 como compatibilidade futura

**Estado:** aceita

As entidades necessárias existem nos dois esquemas (verificado no IfcOpenShell 0.9.0; ver `IFC_MAPPING.md`). `IfcFacility` existe apenas no 4.3, o que pesa a favor dele para infraestrutura.

## ADR-015 — Backend em Python gerenciado por uv

**Estado:** aceita

FastAPI + Pydantic, com `uv` para ambiente e lockfile. O IfcOpenShell será adicionado apenas na Fase 3. Python 3.11 foi fixado por ser a versão com melhor disponibilidade de binários do IfcOpenShell no ambiente de desenvolvimento.

## ADR-016 — Testes ponta a ponta com Playwright

**Estado:** aceita

Os critérios de aceite são verificados em navegador real (Chromium, WebGL por software), além dos testes unitários. Para isso, toda ação relevante possui um caminho determinístico na interface (entrada por coordenadas, lista de elementos, ações nas portas), o que também serve à precisão exigida em engenharia.

## ADR-017 — Exportador IFC em TypeScript, verificado com IfcOpenShell

**Data:** 2026-11-16 · **Estado:** aceita (revê o plano inicial de exportar no backend)

O exportador IFC 4.3 (`packages/ifc`) é uma função pura em TypeScript que escreve o arquivo IFC-SPF. Motivos: funciona no navegador sem servidor implantado; usa a mesma geometria do viewport (uma única fonte); é testável junto com o domínio. O IfcOpenShell continua sendo a referência: os testes do backend abrem os arquivos de `examples/`, rodam `ifcopenshell.validate` e tesselam a geometria. Custo: o escritor STEP é mantido à mão; mitigado pela validação automática.

## ADR-018 — Famílias de conexões como dados do projeto

**Estado:** aceita

As famílias (tabelas dimensionais) vivem em `packages/catalog` e podem ser sobrepostas por projeto (`Project.families`). As operações de domínio recebem um `FittingCatalog` e não conhecem o catálogo. O elemento guarda as dimensões resolvidas e o `familyId` de origem; editar uma dimensão à mão desvincula a peça da família. Assim o projeto permanece legível mesmo que o catálogo embutido mude.

## ADR-019 — Porta no fundo da bolsa e na face do flange

**Estado:** aceita

A porta de uma conexão fica onde termina o tubo vizinho: no fundo da bolsa ou na face do flange. A bolsa é geometria que avança sobre o tubo; o comprimento do tubo modelado é o comprimento de corte. Consequência: as dimensões de catálogo usadas são "centro ao fundo da bolsa" e "centro à face do flange".

## ADR-020 — Troca de diâmetro local com reduções automáticas

**Estado:** aceita

O comportamento padrão ao mudar o diâmetro de uma peça é alterar só ela (`resizeWithReducers`): insere redução junto a cada vizinho de outro diâmetro, ajusta reduções existentes e remove as que ficam com os dois lados iguais. O tubo adjacente cede o comprimento; as demais peças não se movem. Sem tubo adjacente para ceder espaço, ou em troca de material, a operação é recusada com explicação. A propagação pelo trecho continua disponível como alternativa.

## ADR-021 — Dados de catálogo: somente valores de fontes abertas e identificadas

**Estado:** aceita

Só entram no catálogo embutido valores lidos de um documento identificado (fabricante, edição, página, URL). Valores derivados são declarados na fonte da família. Tabelas com significado de colunas ambíguo não são usadas (a peça fica com dimensões genéricas, sinalizadas ao usuário). As normas pagas não foram consultadas, e isso é dito na documentação.

## ADR-022 — Geometria das peças por perfis de revolução sobre a linha de centro

**Data:** 2026-11-17 · **Estado:** aceita (complementa a ADR-009)

Conexões e válvulas são geradas por `loft`: uma sequência de anéis (centro, tangente, raio) percorrida em circuito fechado — parede externa, face da extremidade, furo de volta — com grupos de suavização separados por arestas vivas. Substitui a composição de cilindros e esfera, que não representava o corpo curvo dos joelhos de bolsa nem o batente das bolsas. O que é dimensão de catálogo e o que é representação está descrito em `CATALOGS.md`. As malhas de peças diferentes podem se interpenetrar (derivação do tê, haste da válvula); não há união booleana.
