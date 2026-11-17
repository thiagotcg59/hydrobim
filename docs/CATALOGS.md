# Catálogos e famílias

O HydroBIM traz **famílias de conexões** com dimensões transcritas de catálogos de fabricantes e de tabelas normativas. Cada família registra a fonte no campo `source` (visível na seção **Famílias** do editor) e pode ser editada por projeto.

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

### PVC PBA — junta elástica (`pvc-pba-nbr5647-cl15`, `-cl20`)

| Família | Fonte |
| --- | --- |
| Tê, tê de redução, redução ponta e bolsa | Amanco Wavin — FT Linha PBA, jan/2025 (p. 24–25) |
| Tubos classes 15 e 20 | Tigre — Catálogo Infraestrutura 07/2025; Amanco Wavin |

O centro à porta dos tês é **derivado** das cotas totais do catálogo (`L/2 − C` e `L1 − A/2 − C`). Curvas PBA não têm família: as tabelas encontradas não permitem obter o centro à porta sem ambiguidade.

### PVC DEFoFo (`pvc-defofo-nbr7665`)

Tubos: Tigre MPVC DEFoFo (Catálogo Infraestrutura 07/2025, p. 15). Usa as conexões de ferro dúctil (mesmos diâmetros externos).

### Ferro fundido dúctil (`ferro-ductil-nbr7675-k9`)

| Família | Fonte |
| --- | --- |
| Curvas 90°, 45°, 22°30' e 11°15' com bolsas e com flanges PN 10 | Saint-Gobain PAM — Water supply and distribution, ed. 2010 |
| Tê e redução com bolsas e com flanges PN 10 | idem (p. 411–419, 535–573) |

**Ressalvas:** é a edição **internacional** de 2010 (EN 545 / ISO 2531); o catálogo brasileiro da PAM não pôde ser consultado. A equivalência entre a junta STANDARD e a JGS/JE2GS brasileira é uma suposição. Valores copiados como impressos, inclusive os que parecem erros do catálogo (curvas flangeadas de 22°30' e 11°15' em DN 500/600 repetem os valores da de 45°).

### Válvulas flangeadas

| Família | Fonte |
| --- | --- |
| Gaveta cunha de borracha, corpo curto (EN 558 série 14) e longo (série 15) | AVK, séries 06/30 e 02/60 |
| Borboleta wafer (EN 558 série 20) | AVK, série 820 |
| Retenção portinhola (EN 558 série 48) | AVK, série 41/60 |
| Ventosa flangeada | AVK, série 701/70 |

A altura é do eixo ao topo da haste (o volante é acessório). Não foi possível obter tabelas de fabricantes brasileiros de válvulas.

### Aço-carbono — solda de topo (`aco-carbono-b3610-sch40`)

Curvas 90° e 45° de raio longo, tê reto e redução concêntrica: ASME B16.9, conforme as tabelas de wermac.org (fonte secundária).

### Sem família (dimensões genéricas)

Conexões de PEAD, curvas de PVC PBA, joelhos de ângulo não padronizado, válvulas em PVC que não sejam o registro de esfera, bombas e reservatórios. O editor identifica essas peças como "dimensões genéricas (fora de catálogo)" e as conta no resumo do projeto.

## Geometria

A geometria 3D usa as dimensões principais da família: posição das portas, profundidade e diâmetro externo das bolsas, diâmetro e espessura dos flanges, face a face, altura e volante das válvulas. O contorno do corpo entre essas dimensões é simplificado (cilindros, cones e arcos); raios de concordância, nervuras, furação de flanges e detalhes de fundição não são modelados.

## Editar famílias

**Famílias** (barra superior) → escolha a especificação e a família → edite as células (em mm) → **Salvar no projeto**. Com "Aplicar às peças do projeto" marcado, as peças já inseridas são recalculadas e os tubos vizinhos reajustados; se alguma não puder ser ajustada, nada é alterado. A família alterada fica gravada no arquivo do projeto e pode ser restaurada ao catálogo. "Duplicar como nova família" cria uma família própria.

## Acrescentar famílias ao catálogo embutido

Arquivos em `packages/catalog/src/families/`, com dimensões em milímetros. Registre sempre fabricante, norma, fonte (documento, página, URL) e qualquer valor derivado. `families.test.ts` valida todas as famílias e confere valores por amostragem.
