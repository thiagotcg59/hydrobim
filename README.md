# HydroBIM

Plataforma BIM hidráulica 3D para MEP, redes de abastecimento e adutoras, com interoperabilidade IFC.

O HydroBIM é um **editor BIM paramétrico web**: os componentes hidráulicos têm parâmetros de engenharia, portas de conexão e conectividade explícita, e a geometria 3D é derivada desses parâmetros. Não é um visualizador IFC — o IFC será um formato de intercâmbio, gerado a partir do modelo próprio.

> **Estado atual:** Fases 0 e 1 concluídas; Fases 2 a 6 parcialmente implementadas. O que falta em cada fase está no [roadmap](docs/ROADMAP.md).

## O que já funciona

**Modelagem**
- Viewport 3D (Z para cima) com órbita, grade, eixos, vistas e projeção ortográfica.
- Planta baixa em traço técnico gerada do modelo, com cotas, textos, chamadas e etiquetas de elementos, escala do desenho e exportação em SVG.
- Tubos por dois pontos (mouse ou coordenadas), com joelho automático ao mudar de direção.
- Joelho, tê (inclusive de redução), redução, válvulas (gaveta, globo, esfera, borboleta, retenção, ventosa, redutora de pressão), bomba e reservatório (genérico ou de catálogo: oito famílias de reservatórios metálicos TRAMEC, com modelos comerciais, acessórios e bocais configuráveis).
- Seleção múltipla, mover, copiar, desfazer/refazer, níveis e sistemas hidráulicos.

**Catálogo e famílias**
- Famílias de conexões com dimensões de catálogos (Krona, Tigre, Amanco Wavin, Saint-Gobain PAM, AVK, ASME B16.9), cada uma com a fonte registrada — ver [catálogos](docs/CATALOGS.md).
- Seção **Catálogo**: famílias de conexões (consultar e editar as tabelas dimensionais por projeto e reaplicar às peças já inseridas), reservatórios (tabelas e modelo 3D) e biblioteca de produtos.
- Geometria com bolsas (furo e batente), flanges, corpo curvo e dimensões principais das famílias.

**Troca de diâmetro inteligente**
- Por padrão, alterar o diâmetro muda **apenas a peça selecionada**: reduções de catálogo são inseridas junto aos vizinhos, ajustadas se já existirem e removidas quando deixam de ser necessárias. A alternativa é aplicar a todo o trecho conectado.

**Interoperabilidade e análises**
- Exportação **IFC 4.3** no navegador, verificada com IfcOpenShell — rede e arquitetura no mesmo arquivo (paredes, lajes, revestimentos, portas e janelas com vãos reais, ambientes, camadas de material e quantitativos).
- Exportação **DXF**: planta baixa em R2000 (camadas `REDE_*` por categoria, cotas como `DIMENSION`, conexões como blocos, textos e etiquetas) e modelo 3D em malhas (metros).
- Quantitativo em CSV e rede em formato EPANET (INP).
- Georreferência informada pelo usuário, terreno por pontos XYZ, perfil longitudinal com recobrimento e detecção de interferências entre tubos.
- Superfície do terreno por área na Planta Infra: DEM em ladrilhos, GeoTIFF ou levantamento com linhas de quebra; curvas de nível, consulta de cota, corte longitudinal e visualização 3D em escala real (`docs/INFRA.md`).
- Salvar/abrir no navegador e em arquivo JSON versionado (projetos antigos são migrados).

**Realidade virtual (WebXR)**
- Visualizar › **Entrar em VR**: o modelo aberto, em escala real, no navegador de um headset (referência: Meta Quest 2), com teletransporte, giro por etapas, seleção com os controles e painel de propriedades. Modo de inspeção, sem aplicativo separado. Testado com um dispositivo simulado; **a validação em headset físico está pendente** — ver [realidade virtual](docs/WEBXR.md).

## Requisitos

| Ferramenta | Versão testada |
| --- | --- |
| Node.js | 24 (mínimo 20.19) |
| npm | 11 |
| Python | 3.11 |
| uv | 0.12 |

## Como executar

### Editor web

No Windows, pelo PowerShell, dentro da pasta do projeto:

```powershell
.\iniciar.ps1
```

O script confere as dependências e abre <http://localhost:5180> no navegador. Para **encerrar a sessão, pressione Q** na janela do PowerShell: o editor fecha, o `npm run check` roda e, se passar, a branch de trabalho é enviada ao GitHub (veja [AGENTS.md](AGENTS.md), "Convenções Git"). Se houver alterações sem commit, o script pede a mensagem do commit; Enter deixa esses arquivos de fora.

| Comando | O que faz |
| --- | --- |
| `.\iniciar.ps1` | Abre o editor; ao encerrar com Q, verifica e envia |
| `.\iniciar.ps1 -SemEnviar` | Abre o editor sem enviar nada ao encerrar |
| `.\iniciar.ps1 -SomenteEnviar` | Não abre o editor; só verifica e envia |

Ctrl+C também fecha o editor, mas sem enviar. Sem o script: `npm install` e `npm run dev`. Na primeira execução é carregado um projeto de demonstração.

Versão publicada (branch `main`): <https://thiagotcg59.github.io/hydrobim/>.

Build de produção: `npm run build` (saída em `apps/web/dist`) e `npm run preview` para servi-la.

### API (opcional na Fase 1)

```bash
cd services/api
uv sync
uv run uvicorn hydrobim_api.main:app --reload --port 8000
```

Documentação interativa em <http://localhost:8000/docs>. O editor ainda não depende da API; ela valida projetos (`POST /api/v1/projects/validate`) e será a base da exportação IFC.

## Como usar (roteiro rápido)

A tela tem o cabeçalho (menu **Arquivo**, nome do projeto, salvar/desfazer/refazer e o **Ambiente** MEP/Infra), a faixa de comandos com uma aba por tarefa (**Modelagem**, **Documentação**, **Visualizar**, **Análise**, **BIM / IFC**, **Exportação**, **Gerenciar**), o navegador do projeto à esquerda, as abas de vista (**Modelo 3D** e **Planta**) sobre a área de desenho e, à direita, o painel com as abas **Ferramenta** (opções do próximo elemento) e **Propriedades** (seleção). `Ctrl+K` busca qualquer comando. Detalhes em [docs/INTERFACE.md](docs/INTERFACE.md).

1. **Tubulação** (`T`): escolha especificação e diâmetro, clique o ponto inicial e os seguintes. `Shift` restringe à vertical; `Esc` encerra. Também é possível digitar X, Y, Z e usar **Adicionar ponto**.
2. **Selecionar** (`S`): clique em um elemento ou escolha-o no navegador do projeto, à esquerda. Na vista 3D, arraste com o botão esquerdo para abrir uma janela e selecionar os elementos inteiramente dentro dela (`Ctrl`/`Shift` soma à seleção); nessa ferramenta a câmera orbita com o botão do meio ou `Alt` + arrastar.
3. No painel **Propriedades**: altere diâmetro/material, comprimento e coordenadas de extremidades livres; em **Portas de conexão**, acople joelho, tê, válvula ou redução a uma extremidade livre; em **Inserir em linha**, divida o tubo com um tê ou uma válvula.
4. **Joelho** (`J`), **Tê** (`E`), **Redução** (`R`), **Válvula** (`V`): clique em uma extremidade livre (marcadores ciano) ou, para tê e válvula, sobre um tubo.
5. **Bomba** (`B`) e **Reservatório** (`Q`): clique um ponto ou informe as coordenadas. A bomba pode ser a genérica ou uma bomba anfíbia HIGRA do catálogo (Catálogo → Bombas), com as cotas do dimensional do fabricante.
6. **Trocar diâmetro**: no painel, escolha o novo diâmetro. Com "Somente esta peça" as reduções são criadas automaticamente; com "Todo o trecho conectado" a alteração se propaga.
7. **Catálogo** (Modelagem ou Gerenciar): abre as famílias de conexões (consulta e edição), os reservatórios e a biblioteca de produtos 3D.
8. **Gerenciar**: níveis, sistemas, georreferência e terreno. **Análise**: pendências, interferências, quantitativo e perfil longitudinal.
9. **Salvar** (`Ctrl+S`) grava no navegador; **Arquivo › Baixar arquivo** gera o `.hydrobim.json`; a aba **Exportação** reúne IFC, IDS, DXF (planta e modelo 3D), SVG da planta, CSV do quantitativo e INP do EPANET, com o conteúdo e os requisitos de cada saída; **Arquivo › Abrir** lista os projetos salvos e importa arquivos. `Ctrl+clique` seleciona vários elementos.
10. **Planta** (aba de vista sobre a área de desenho, ou qualquer ferramenta de **Documentação**): **Cota** (`C`) — dois pontos e a posição da linha; **Texto** (`X`); **Chamada** (`L`) — ponto indicado e posição do texto; **Etiqueta** (`I`) — elemento e posição. Com **Selecionar**, arraste uma anotação para reposicioná-la e edite-a no quadro à direita; `Delete` exclui. Escolha a **Escala** em Documentação e use Exportação › **SVG da planta** para gerar o desenho.

A barra inferior mostra a instrução da operação, coordenadas, captura, grade, mensagens e o resultado da validação (clique para ver as pendências).

## Qualidade

```bash
npm run lint           # ESLint
npm run format:check   # Prettier
npm run typecheck      # TypeScript estrito
npm test               # testes unitários e de integração (Vitest)
npm run build          # build de produção
npm run test:e2e       # testes ponta a ponta no Chromium (Playwright)
npm run check          # lint + typecheck + test + build
```

Na primeira vez, instale o navegador dos testes E2E com `npx playwright install chromium`.

Backend: `cd services/api && uv run ruff check . && uv run pytest`.

## Estrutura

```
apps/web/            Editor React + Three.js (interface, viewport, estado, persistência)
packages/core/       Modelo de domínio, portas, conectividade, operações, validação, serialização;
                     arquitetura (paredes, pisos, portas, janelas, ambientes) em architecture/
packages/geometry/   Malhas paramétricas dos elementos (independente de motor gráfico)
packages/catalog/    Especificações de tubos, famílias de conexões e famílias arquitetônicas (catálogos)
packages/ifc/        Exportação IFC 4.3 (escritor IFC-SPF puro, roda no navegador)
packages/dxf/        Exportação DXF (planta anotada em R2000 e modelo 3D em R12)
services/api/        API FastAPI (validação do projeto; verificação do IFC nos testes)
examples/            Projetos de demonstração (.hydrobim.json)
tests/               Testes de integração e ponta a ponta
docs/                Arquitetura, modelo de domínio, mapeamento IFC, decisões, roadmap
```

## Documentação

- [Arquitetura](docs/ARCHITECTURE.md)
- [Modelo de domínio](docs/DOMAIN_MODEL.md)
- [Catálogos e famílias](docs/CATALOGS.md)
- [Mapeamento IFC](docs/IFC_MAPPING.md)
- [Ambiente Infra](docs/INFRA.md)
- [Arquitetura](docs/ARQUITETURA.md) — paredes, pisos, portas, janelas e ambientes; requisitos adotados e limites
- [Realidade virtual (WebXR)](docs/WEBXR.md) — arquitetura, controles, publicação e roteiro de teste no headset
- [Decisões técnicas](docs/DECISIONS.md)
- [Roadmap](docs/ROADMAP.md)
- [Instruções para agentes e colaboradores](AGENTS.md)

## Aviso de engenharia

As dimensões vêm de catálogos de fabricantes e de fontes secundárias de normas, levantadas em novembro de 2026; confira com o catálogo vigente do fornecedor antes do uso em projeto. A geometria reproduz as dimensões principais das famílias, com contorno simplificado. Peças sem família de catálogo usam proporções genéricas e são identificadas como tal. Rugosidades e demais parâmetros hidráulicos exportados para o EPANET são valores de referência a revisar.
