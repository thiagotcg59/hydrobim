# Catálogos e famílias

O HydroBIM traz **famílias de conexões** com dimensões transcritas de catálogos de fabricantes e de tabelas normativas. Cada família registra a fonte no campo `source` (visível na seção **Catálogo** do editor) e pode ser editada por projeto.

> **Aviso de engenharia.** São dimensões de fabricante ou de fontes secundárias, levantadas em novembro de 2026. Variam entre marcas e edições. Confira com o catálogo vigente do fornecedor antes de usar em projeto executivo. As normas ABNT/EN/ASME em si não foram consultadas (são pagas).

## O que cada dimensão significa

| Tipo | Dimensões usadas |
| --- | --- |
| Joelho/curva | centro (vértice teórico) à porta; bolsa ou flange |
| Tê | centro à porta da passagem; eixo à porta da derivação; DN da derivação |
| Redução | distância entre as portas; DN maior e menor |
| Válvula | face a face; altura do eixo ao topo; volante/alavanca |

**Onde fica a porta:** em bolsas, no fundo da bolsa (onde a ponta do tubo encosta); em flanges, na face do flange; em pontas lisas, na extremidade. A bolsa avança sobre o tubo pela sua profundidade; o flange fica da face para dentro da peça.

## Fontes

### PVC soldável — água fria predial (`pvc-soldavel-nbr5648`)

| Família | Fonte |
| --- | --- |
| Joelho 90° e 45°, tê, tê de redução, luva de redução, bucha de redução longa | Krona — Catálogo Técnico Linha Soldável (p. 5–9) |
| Registro de esfera VS | Tigre — FT Registros de Esfera 2025 (p. 6) |
| Tubos | Tigre, Amanco Wavin e Krona (séries idênticas) |

A Krona foi usada por ser o único catálogo que tabula profundidade e diâmetro externo da bolsa e a distância do centro ao fundo da bolsa. Entre fabricantes, o centro à face difere em 0,5 a 2 mm na maioria dos diâmetros (mais em DE 110).

### PVC PBA — junta elástica (`pvc-pba-nbr5647-cl12`, `-cl15`, `-cl20`)

| Família | Fonte |
| --- | --- |
| Tê, tê de redução, redução ponta e bolsa | Amanco Wavin — FT Linha PBA, jan/2025 (p. 24–25) |
| Tubos classes 12, 15 e 20 | Amanco Wavin — FT Linha PBA, jan/2025 (p. 14–15); classes 15 e 20 também em Tigre — Catálogo Infraestrutura 07/2025 |

O centro à porta dos tês é **derivado** das cotas totais do catálogo (`L/2 − C` e `L1 − A/2 − C`). As curvas PBA de 90°, 45°, 22°30′ e 11°15′ (DN 50, 75 e 100) são famílias de joelho **ponta e bolsa**: a porta `a` fica no fundo da bolsa e a porta `b` na extremidade da ponta (que entra na bolsa do tubo seguinte), a distâncias diferentes do vértice — `centerToEnd` = S + R·tg(θ/2) e `centerToEnd2` = F + R·tg(θ/2), com `bendRadius` = R. O raio R e o trecho reto S **não são tabulados**: vêm da hipótese descrita na biblioteca de produtos, abaixo (a 90°, o vértice ao fundo da bolsa é `L − C − D/2`, independente do raio). A ressalva está no campo `source` de cada família.

### PVC DEFoFo (`pvc-defofo-nbr7665`)

Tubos: Tigre MPVC DEFoFo (Catálogo Infraestrutura 07/2025, p. 15). Usa as conexões de ferro dúctil (mesmos diâmetros externos).

### Ferro fundido dúctil (`ferro-ductil-nbr7675-k9`)

| Família | Fonte |
| --- | --- |
| Curvas 90°, 45°, 22°30' e 11°15' com bolsas e com flanges PN 10 | Saint-Gobain PAM — Water supply and distribution, ed. 2010 |
| Tê e redução com bolsas e com flanges PN 10 | idem (p. 411–419, 535–561) |
| Flange PN 10 das peças flangeadas | tabela única de flanges (ver abaixo) |

**Ressalvas:** é a edição **internacional** de 2010 (EN 545 / ISO 2531); o catálogo brasileiro da PAM não pôde ser consultado. A equivalência entre a junta STANDARD e a JGS/JE2GS brasileira é uma suposição. Valores copiados como impressos, inclusive os que parecem erros do catálogo (curvas flangeadas de 22°30' e 11°15' em DN 500/600 repetem os valores da de 45°).

### Flanges — tabela única (`packages/catalog/src/flanges.ts`)

**Fonte:** "Catálogo Geral" (arquivo `CATÁLOGO GERAL.pdf`, fornecido pelo responsável do projeto), capítulo 4, linha Água e Esgoto, p. 246–249 — "Junta com Flange – PN 10 / PN 16 / PN 25 / PN 40". **As páginas recebidas não trazem o fabricante, a edição nem a norma do flange**; esses campos estão declarados como não identificados e devem ser completados com a capa/ficha do catálogo.

| Classe | Página | Diâmetros |
| --- | --- | --- |
| PN 10 | 246 | DN 50 a 1200 (17) |
| PN 16 | 247 | DN 50 a 1200 (17) |
| PN 25 | 248 | DN 50 a 1200 (17) |
| PN 40 | 249 | DN 50 a 600 (12) |

Cotas transcritas linha a linha (conferidas por `flanges.test.ts`): `D` (Ø externo), `C` (círculo de furação), `d` (Ø dos furos), quantidade e dimensão nominal dos parafusos, `a` (espessura), `g` e `c` (Ø e altura do ressalto). DN 1400 a 2000 constam como "Consultar" e não foram cadastrados.

**Padronização.** Todas as peças flangeadas PN do catálogo embutido — curvas, tês e reduções PAM, válvulas AVK e a redutora BERMAD — passaram a usar o flange **PN 10** desta tabela (antes: tabela PAM p. 572, sem furação nem ressalto). Os valores coincidem com os anteriores, exceto a espessura em DN 600 (30 mm aqui; 29 mm na PAM); a BERMAD ganhou flange em DN 50 e 450. Famílias novas com flange PN devem usar `flangeEndMm(classe, DN)`; onde a tabela não tem o DN (ex.: 40, 65, 125), a peça fica **sem** flange — nada é interpolado.

**Exceção:** o filtro Y Spirax Sarco mantém o flange **ASME B16.1 classe 125** informado pelo fabricante (furação diferente da PN 10); trocá-lo descaracterizaria o produto.

**Leitura adotada (hipótese declarada):** no corte do desenho as cotas `c` e `a` partem da face de vedação; lê-se que a espessura `a` **inclui** o ressalto `c`. A porta fica na face do ressalto.

**Não tabulado (representação):** cubo do flange (raio = raio do tubo + 0,6·`a`, limitado pela furação) e o furo (o do tubo da peça). Parafusos, juntas, chanfros e marcações não são modelados; a dimensão dos parafusos fica registrada na tabela para consulta.

Na seção **Catálogo**, a aba **Flanges e tubos flangeados** mostra as quatro tabelas e o modelo 3D do flange avulso de cada linha (disco furado, ressalto e cubo). O furo do flange avulso adota o Ø externo do tubo de ferro dúctil K9 de mesmo DN; para DN sem tubo no catálogo embutido (50, 450, 700 a 1200) o modelo não é gerado.

### Tubos de ferro fundido dúctil com flanges (`tubo-fofo-flanges-pn10`, `-pn16`, `-pn25`, `-pn40`)

Corpo: tubo da especificação `ferro-ductil-nbr7675-k9` (DN 80 a 600). Flanges: tabela única, na classe da família. Configurações: **flange e flange**, **flange e ponta** (flange no início ou no fim) e **ponta e ponta**. O **comprimento é livre**, medido entre as portas (face do flange ou extremidade da ponta) — as páginas recebidas não tabulam comprimentos padronizados de tubos e tocos, por isso não há "modelos comerciais". A classe de espessura do tubo flangeado do fabricante também não consta: usa-se a K9 da especificação embutida.

Uso: ferramenta **Tubo** → "Extremidades do tubo" (configuração e classe do flange) ou, para um tubo existente, painel de propriedades → **Extremidades**. Ao dividir um tubo flangeado (tê ou válvula em linha), cada trecho conserva só o flange da sua extremidade original; ao trocar o diâmetro, o flange acompanha o novo DN pela mesma família.

### Válvulas flangeadas

| Família | Fonte |
| --- | --- |
| Gaveta cunha de borracha, corpo curto (EN 558 série 14) e longo (série 15) | AVK, séries 06/30 e 02/60 |
| Borboleta wafer (EN 558 série 20) | AVK, série 820 |
| Retenção portinhola (EN 558 série 48) | AVK, série 41/60 |
| Ventosa flangeada | AVK, série 701/70 |
| Redutora de pressão pilotada, corpo em Y — Modelo 720, série 700 SIGMA EN (DN 40–400) e ES (DN 65–600) | BERMAD, *700 Series Engineering Data*, p. 10 e 12 |
| Filtro Y de ferro fundido cinzento, flangeado ASME B16.1 classe 125 — modelo CI, 2" a 16" (aço-carbono) | Spirax Sarco, TI-D245-01 BR Rev. 00, p. 2; flange: ASME B16.1-1998 conforme amesweb.info |
| Gaveta com cunha de borracha, linha EURO 20: EURO 21 (flanges, corpo longo, DN 50–300), EURO 22 (flanges ANSI, DN 80–300), EURO 23 (flanges, corpo curto, DN 50–400), EURO 24 (bolsas PVC PBA, DN 50–100) e EURO 25 (bolsas ferro dúctil/DEFoFo, DN 80–300) | Catálogo Geral (CATÁLOGO GERAL - VALVULA GAVETAS.pdf), cap. 6, p. 344–348 — fabricante não identificado nas páginas recebidas |

A altura é do eixo ao topo da haste (o volante é acessório). Não foi possível obter tabelas de fabricantes brasileiros de válvulas. As páginas da AVK e da BERMAD não tabulam o flange: usa-se o PN 10 da tabela única.

### Aço-carbono — solda de topo (`aco-carbono-b3610-sch40`)

Curvas 90° e 45° de raio longo, tê reto e redução concêntrica: ASME B16.9, conforme as tabelas de wermac.org (fonte secundária).

### Sem família (dimensões genéricas)

Conexões de PEAD, joelhos de ângulo não padronizado, válvulas em PVC que não sejam o registro de esfera, bombas e o reservatório cilíndrico genérico (os reservatórios metálicos de catálogo estão descritos adiante). O editor identifica essas peças como "dimensões genéricas (fora de catálogo)" e as conta no resumo do projeto.

## Geometria

A geometria 3D (`packages/geometry`) é gerada por perfis de revolução ao longo da linha de centro da peça (`loft.ts`).

**Vem do catálogo:** posição das portas (centro ao fundo da bolsa ou à face do flange), raio de curvatura da linha de centro, profundidade e diâmetro externo das bolsas, diâmetro, espessura, furação e ressalto dos flanges, face a face, altura e volante/alavanca das válvulas, diâmetros externo e interno do tubo. As bolsas têm o furo com o diâmetro externo do tubo e o batente no fundo; o furo do corpo tem o diâmetro interno do tubo.

**É representação (não tabulado nas fontes usadas):** a parede do corpo das conexões (adota-se o diâmetro externo do tubo), a concordância entre corpo e bolsa, o cubo dos flanges, o bojo, o castelo e o acionamento das válvulas. Parafusos, anéis de vedação, nervuras e detalhes de fundição não são modelados. Todas as peças usam o mesmo disco de flange (`flangeDisc`: furos e ressalto quando tabulados) e o mesmo cubo de representação.

**Gavetas EURO 20 (EURO 21 a 25):** as tabelas dão L (face a face), H1 (do eixo ao topo da haste), H (altura total com o cabeçote), D e a (flange) e K × K1 (castelo). Usam-se L → `length`, H1 → `height`, K → `bonnetLength` (ao longo do eixo do tubo) e K1 → `width` (transversal). A família é a versão "com cabeçote", de haste nua: H, o cabeçote e o volante não entram (o diâmetro do volante não é tabulado), nem o número de voltas e as massas. Flanges PN: pela regra 14, o flange inteiro vem da tabela única, na classe da família — há famílias PN 10/16 (PN 16 a partir de DN 200), PN 10 (DN 200 em diante) e PN 25, como na tabela de abreviaturas; os D e a impressos na página da válvula coincidem com a tabela, exceto no DN 100 (página da válvula: 225; tabela: 220 — vale a tabela). EURO 22 (ANSI): D e a da própria página e furação ASME B16.1 classe 125 pela fonte secundária do filtro Y; oferecida ao aço-carbono. EURO 24: a bolsa não é tabulada — profundidade derivada (L − L1)/2 e diâmetro externo adotado 2·h. EURO 25: Lu, P e D1 da tabela; em DN 200 e 300 o Lt impresso excede Lu + 2·P em 17 e 23 mm (usado o Lu impresso); no DN 100, K impresso "11" foi adotado como 111. O DN 50 consta das tabelas, mas o ferro dúctil embutido começa em DN 80. A geometria (`gateValve.ts`) segue a fotografia de referência e os cortes do catálogo: corpo passante, flanges furados ou bolsas, castelo retangular de cantos arredondados com a seção K × K1, preme-gaxeta, haste nua com quadrado de manobra e plaqueta, tudo com o revestimento epóxi azul (substituído pela cor do sistema, quando definida). No corpo curto, em que K supera o face a face, o castelo só atinge a seção cheia acima dos flanges. A altura em que o castelo atinge K × K1, o preme-gaxeta, a haste e a plaqueta são representação; nervura, orelhas de içamento e marcações não são modeladas. As gavetas AVK continuam com o castelo genérico e volante.

**Filtro Y Spirax Sarco CI:** a folha TI-D245-01 dá A (face a face), B (do eixo ao ponto mais baixo do bojo) e C (distância para manutenção). A e B viram `length` e `height` — no filtro, `height` é medida para BAIXO; C é folga para retirar a tela e não entra na peça; os pesos não são registrados. O flange não é tabulado ("Flangeado ASME B16.1 125#"): diâmetro externo, espessura e furação (círculo, número e diâmetro dos furos) vêm da ASME B16.1-1998 classe 125, pela tabela de [amesweb.info](https://amesweb.info/Piping/Class-125-Cast-Iron-Flanges-Dimensions-Chart.aspx) — fonte secundária, convertida de polegadas; a norma não foi consultada. A família é oferecida ao aço-carbono ASME B36.10, cujo flange B16.5 classe 150 tem a mesma furação; não é oferecida ao ferro dúctil (flanges EN 1092-2 PN). 14" e 16" constam da tabela, mas a especificação de tubo embutida vai até DN 300. A geometria (`strainer.ts`) segue o desenho e a fotografia do fabricante, escalados pelo diâmetro do tubo: corpo cilíndrico com cubos, bojo a 45° para jusante, flange do bojo, junta, tampa aparafusada e bujão sextavado; o ponto mais baixo do conjunto fica exatamente na cota B. Essas proporções, a quantidade de parafusos da tampa e o bujão são representação; a tela interna e a nervura do corpo não são modeladas. A cor é o cinza-azulado da pintura do fabricante (substituída pela cor do sistema, quando definida). Os flanges saem com os furos da norma (`flange.ts`) — recurso disponível a qualquer família que informe a furação.

**Redutora de pressão BERMAD 720:** a tabela dá L (face a face), W (largura máxima), h (eixo ao ponto mais baixo) e H (altura total), as três últimas como valores máximos. A altura do eixo ao topo é derivada (H − h) e W é adotada como diâmetro da tampa do atuador. O flange não é tabulado pela BERMAD ("all standards"): usa-se o flange PN 10 da tabela única de flanges onde há dado; DN 40, 65 e 125 ficam sem o disco do flange. A geometria (`pilotValve.ts`) segue o desenho dimensional do fabricante, escalado pelas cotas de catálogo: corpo em Y com pescoço oblíquo, atuador inclinado ~24° para jusante, flanges do atuador aparafusados e tampa abaulada rasa com bujão. Essas proporções, a quantidade de parafusos e todo o circuito de controle (piloto com campânula de mola, registros, conexões e tubos) são representação — o catálogo não os dimensiona, e o circuito pode ultrapassar a altura de catálogo, que é a da válvula básica. O corpo aparece com o revestimento epóxi azul informado pelo fabricante (substituído pela cor do sistema, quando definida); os acessórios, em inox. O catálogo embutido só tem tubos de ferro dúctil a partir de DN 80, de modo que os DN 40 a 65 e 125/450 constam da tabela da família, mas ainda não têm tubo correspondente para inserção.

**Dúvida registrada:** no registro de esfera VS (Tigre) a altura do eixo ao topo foi derivada como `B − E1/2`; o resultado fica abaixo do raio das porcas (`E1/2`), o que sugere que a cota `B` do catálogo tem outra referência. A alavanca aparece embutida entre as porcas até a cota ser conferida no desenho do fabricante.

## Biblioteca de produtos (modelos 3D de catálogo)

Além das famílias de conexões — que alimentam as operações de domínio —, o catálogo traz uma **biblioteca de produtos** (`packages/catalog/src/products/`): as tabelas completas do fabricante, com as letras das cotas como impressas, e o modelo 3D gerado a partir delas (`packages/geometry/src/pba.ts`). Fica na aba **Biblioteca de produtos (3D)** da seção Catálogo, é somente leitura e não altera o projeto.

### Linha PBA — Amanco Wavin (FT Linha PBA, FTC000088, rev. jan/2025)

| Produto | Página | Na rede |
| --- | --- | --- |
| Tubo classes 12, 15 e 20 (DN 50, 75, 100) | 14–15 | tubo da especificação correspondente (trecho de comprimento livre, sem a bolsa) |
| Curvas ponta e bolsa 11°15′, 22°30′, 45° e 90° | 20–22 | sim, como joelho (raio derivado por hipótese) |
| Tê e tê de redução | 24–25 | ferramenta Tê, com a mesma geometria |
| Cruzeta e cruzeta de redução | 18, 20 | ainda não (Fase 2) |
| Redução ponta e bolsa | 24 | ferramenta Redução (comprimento da ponta proporcional) |
| Luva de correr, luva simples, cap | 17–18, 23–24 | ainda não (Fase 2) |
| Adaptador DEFoFo × PBA | 17 | ainda não (Fase 2) |
| Colar de tomada (DN 50 a 100, saídas ½" e ¾") | 18–19 | ainda não (Fase 2) |
| Anéis JERI e O'Ring | 15–16 | acessórios; o JERI aparece montado no modelo do tubo |

A pasta lubrificante (p. 26) não é componente da tubulação e não foi modelada.

**Vem da tabela e é reproduzido pelo modelo** (conferido por teste, linha a linha): Ø externo (A), Ø da boca (B) e profundidade (C) das bolsas; Ø e comprimento das pontas (D, F); comprimentos e alturas totais (L, L1); espessura dos tubos (e); cotas dos anéis.

**Não é tabulado — derivado ou adotado, e identificado no editor em cada produto:**

- **Parede e furo das conexões:** os do tubo classe 20 de mesmo DN ("as conexões são dimensionadas para a classe 20", FT p. 2).
- **Alojamento do anel na bolsa:** posição, largura e concordâncias são representação; o ressalto externo tem o Ø A da tabela.
- **Raio das curvas:** a cota L é lida como a projeção, no eixo da bolsa, da boca ao ponto mais afastado da ponta: `L = C + S + R·sen θ + F·cos θ + (D/2)·sen θ`. Supondo o mesmo raio R e o mesmo trecho reto S nas curvas de 45° e 90° de cada DN, obtém-se `R = (L90 − L45 + F·cos 45°)/(1 − sen 45°) − D/2` (104,5 / 158,8 / 212,4 mm). Com esse raio, o trecho reto de cada curva sai da sua própria cota L, que o modelo reproduz exatamente. É uma **hipótese de leitura do desenho**: confirmar com o fabricante antes de usar o raio em projeto.
- **Luva de correr:** a tabela não traz a profundidade da bolsa; os alojamentos foram posicionados como nas demais conexões injetadas (cota C do tê).
- **Colar de tomada:** o Ø do ressalto e o comprimento da saída roscada vêm das linhas 25–40 da própria tabela (por rosca); a espessura da abraçadeira é derivada, `(L1 − D − comprimento da rosca)/2`; a rosca é representada lisa, com o Ø nominal G ½ / G ¾ (ISO 228-1 — o catálogo não identifica o padrão). Comprimento da abraçadeira, abas e detalhes são representação.

**Divergências do próprio catálogo (transcritas como impressas e sinalizadas no editor):** as tabelas das curvas de 11°15′ e 22°30′ são idênticas; no colar de tomada, as linhas 25, 32 e 40 trazem nas colunas L e D valores que acompanham a rosca e não o tubo — essas linhas **ficam sem modelo 3D**; a linha "40 x ¾" traz R = ½; o adaptador 95754 é descrito como "DN 110"; as bolsas dos tubos têm as mesmas cotas nas três classes.

**Qualidade das malhas:** cada peça é um sólido fechado (toda aresta compartilhada por dois triângulos de sentidos opostos — `countOpenEdges`), oco, com o batente no fundo das bolsas. Em tês, cruzetas e no colar, a derivação nasce sobre a curva de interseção com a passagem e o furo atravessa a parede (`skin.ts`), sem sólidos sobrepostos.

## Reservatórios metálicos (famílias de reservatórios)

Dados em `packages/catalog/src/tanks/`; o tipo `TankFamily` e tudo o que é derivado (cotas características, volume, origem dos parâmetros) ficam em `packages/core/src/tanks.ts`. Na seção **Catálogo**, a aba **Reservatórios** lista as famílias com a tabela do fabricante, o modelo 3D de cada linha, o que não é tabulado e as divergências; **Inserir no modelo** abre a ferramenta Reservatório com a família e o modelo escolhidos. As famílias de fabricante são embutidas e somente leitura: o usuário escolhe um **modelo comercial** ou informa **dimensões personalizadas**, e a forma construtiva da família é mantida.

**Famílias personalizadas.** "Duplicar como família personalizável" cria, no projeto (`Project.tankFamilies`), uma cópia da família com a mesma forma construtiva e a mesma tabela — agora editável: nome, capacidade, altura total, diâmetro e altura da coluna de cada linha, além de acrescentar e remover linhas. O modelo 3D acompanha o rascunho. Ao salvar, com "Aplicar aos reservatórios do projeto" marcado, os reservatórios já inseridos que usam um modelo da família são recalculados (os tubos conectados se reajustam; se algum não puder, nada é alterado); o reservatório cuja linha foi removida mantém as dimensões e passa a "dimensões personalizadas". A cópia **deixa de ser dado de fabricante**: o fabricante vira "Personalizado", a fonte registra de onde ela veio, e seus valores aparecem no painel e no IFC como *definido pelo usuário*. Tabelas incoerentes (por exemplo, coluna mais alta que o reservatório) são recusadas, com a linha indicada. Excluir a família mantém a forma e as dimensões dos reservatórios, sem vínculo com família ou modelo.

### TRAMEC — Catálogo Caixas d'Água e Reservatórios Metálicos (s/d, 8 p., www.tramec.com.br)

| Família (`id`) | Página | Modelos tabulados | O que o catálogo informa |
| --- | --- | --- | --- |
| Taça com água na coluna (`tramec-taca-com-agua`) | 4 | 19 | capacidade, altura total, Ø da taça |
| Taça sem água na coluna (`tramec-taca-sem-agua`) | 4 | 34 | idem, mais a altura da coluna |
| Tubular alto (`tramec-tubular-alto`) | 5 | 30 | capacidade, altura total, diâmetro |
| Australiano (`tramec-australiano`) | 5 | **nenhum** | só a faixa (4.300 a 540.000 L) e as alturas 0,90 m e 1,72 m |
| Vertical apoiado (`tramec-vertical-apoiado`) | 6 | 10 | capacidade, altura total, diâmetro |
| Vertical de fundo cônico com pés (`tramec-vertical-fundo-conico`) | 6 | 10 | idem; pés padrão de 50 cm |
| Vertical apoiado montado na obra (`tramec-vertical-in-loco`) | 7 | **nenhum** | só a faixa (200.000 a 10.000.000 L) |
| Cilíndrico horizontal (`tramec-cilindrico-horizontal`) | 7 | **nenhum** | só a faixa (2.000 a 20.000 L); longarina ou pés de 0,50 m |

São **113 modelos** transcritos linha a linha (`tanks.test.ts` confere a contagem, amostras de cada tabela e as regras internas das tabelas). Material: "aço carbono estrutural" (p. 3).

**Três famílias não têm tabela no catálogo.** Para elas não existem "tipos comerciais" a cadastrar: o editor pede as dimensões ao usuário e as identifica como definidas por ele. No australiano, o diâmetro é **derivado** da capacidade e da altura do costado (`D = √(4V/πh)`).

**O catálogo não informa** — e por isso nada disso é apresentado como especificação do fabricante:

- **Espessura das chapas.** A propriedade fica vazia até o usuário informá-la; o desenho usa 6 mm apenas para dar corpo às superfícies interna e externa.
- **Diâmetro da coluna e altura da transição cônica das taças** (adotados: metade do Ø da taça, mínimo 0,60 m; 20 % do Ø da taça), **altura da coluna da taça com água** (a que reproduz a capacidade nominal com o Ø de coluna adotado) e **altura do fundo cônico** (80 % da altura dos pés). São proporções lidas das imagens.
- **Bocais.** Entrada, saída, extravasor e descarga são configurados pelo usuário; o diâmetro vem sempre da especificação de tubo escolhida.
- **Escada, gaiola, guarda-corpo, boca de visita, anel de base, pés, berços, ondas da chapa corrugada e revestimento interno.** A forma segue as imagens; as dimensões são de representação (escada de 0,45 m, guarda-corpo de 1,10 m, onda de 76 × 18 mm). O catálogo não mostra plataformas, que não são modeladas.
- **Divisão interna de células.** Registrada como quantidade; não é desenhada (o catálogo não a posiciona).

O painel de propriedades mostra, em cada parâmetro, um selo com a **origem**: *catálogo*, *derivado do catálogo*, *estimado (representação)* ou *definido pelo usuário* (`tankParameterOrigins`, derivado do elemento — editar um valor muda o selo). A mesma classificação é exportada no IFC.

**Leituras adotadas (hipóteses declaradas):** a altura total é a do topo do costado — nos cilindros simples, `π·D²/4·H` reproduz a capacidade nominal —, de modo que guarda-corpo e escada ficam acima dela; a "Altura Coluna" é a cota em que começa a transição cônica; as alturas 0,90/1,72 m do australiano são do costado, sem os pés.

**Divergências do próprio catálogo (transcritas como impressas e mostradas no editor):** o texto fala em taças de 5.000 a 100.000 L, mas as tabelas vão de 2.000 a 80.000 L; a tabela com água na coluna traz Ø 2,22 e 2,54 m onde as demais trazem 2,23 e 2,55 m; oito linhas do tubular alto têm um asterisco sem legenda; o fundo cônico de 12.000 L é 0,40 m (e não 0,50 m) mais alto que o apoiado; há capacidades 12.500 e 30.500 L intercaladas.

## Editar famílias

**Catálogo** (barra superior) → aba **Conexões** → escolha a especificação (ou "Todas as especificações", para ver as famílias de todos os materiais e tipos) e a família → edite as células (em mm) → **Salvar no projeto**. Com "Aplicar às peças do projeto" marcado, as peças já inseridas são recalculadas e os tubos vizinhos reajustados; se alguma não puder ser ajustada, nada é alterado. A família alterada fica gravada no arquivo do projeto e pode ser restaurada ao catálogo. "Duplicar como nova família" cria uma família própria.

Ao abrir uma família, o painel à direita da tabela mostra o **modelo 3D** da linha selecionada (clique em uma linha para trocar; arraste para girar, role para aproximar). O modelo é gerado pela mesma operação usada na inserção (`buildFitting`) a partir do rascunho em edição, portanto reflete cada célula confirmada antes mesmo de salvar. Linhas sem as dimensões obrigatórias, ou cujo DN não existe na especificação de tubo, não exibem modelo — nunca se mostra a proporção genérica no lugar da família.

## Acrescentar famílias ao catálogo embutido

Arquivos em `packages/catalog/src/families/`, com dimensões em milímetros. Registre sempre fabricante, norma, fonte (documento, página, URL) e qualquer valor derivado. Em famílias com flange PN, a extremidade vem de `flangeEndMm(classe, DN)` (tabela única) e a fonte cita `flangeSourceNote(classe)`. `families.test.ts` valida todas as famílias e confere valores por amostragem.

### Materiais de apresentação (cores das vistas 3D)

A aparência das peças fica em uma biblioteca única, `apps/web/src/viewport/materials.ts`, e é reaproveitada por qualquer família nova. É dado de apresentação (cor, rugosidade, metalicidade), não de catálogo.

| Acabamento (`FINISHES`) | Uso | Papel (`PartRole`) |
| --- | --- | --- |
| `pvcBrown` | PVC marrom de água fria | `body` com material `pvc` |
| `hdpeBlack` | PEAD preto | `body` com material `hdpe` |
| `bitumenIron` | Ferro dúctil com pintura betuminosa preta | `body` com material `ductileIron` |
| `carbonSteel` | Aço-carbono aparente (tubos) | `body` com material `carbonSteel` |
| `bareSteel` | Aço aparente de reservatórios e estruturas | `steel` |
| `stainless` | Inox: hastes, parafusos, acessórios | `trim` |
| `galvanized` | Chapa corrugada galvanizada | `galvanized` |
| `paintedCastIron` | Ferro fundido com pintura cinza-azulada do fabricante | `castIron` |
| `blueEpoxy` | Epóxi azul de válvulas de controle | `coated` |
| `blueLiner` | Revestimento interno azul de reservatórios | `liner` |
| `lightPaint` | Pintura clara de reservatórios metálicos | `paint` |
| `actuatorRed` | Volantes e alavancas | `accent` |
| `epdmRubber` | Anéis de vedação | `seal` |

Em uma família nova, a geometria apenas marca cada parte com o papel adequado; a cor nunca é escolhida na geometria nem no componente. Um material que ainda não existe entra em `FINISHES`, ganha um papel em `PartRole` (`packages/geometry/src/elements.ts`) e uma linha em `ROLE_FINISH`. A cor definida no sistema hidráulico substitui a cor de todos os papéis, exceto `accent`, `trim`, `seal` e `liner`.
