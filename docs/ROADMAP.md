# Roadmap

Legenda: ✅ concluído e testado · 🟡 parcial · ⬜ não iniciado

## Fase 0 — Fundação ✅ (CI pendente de primeira execução)

- ✅ Monorepo, TypeScript estrito, ESLint, Prettier, Vitest, Playwright.
- ✅ Frontend React + Vite + Three.js; backend FastAPI + Pydantic.
- 🟡 CI (GitHub Actions) configurado; executa quando houver pull request ou push para `develop`/`main`.

## Fase 1 — MVP funcional ✅

Viewport 3D, tubos por dois pontos, seleção, propriedades, edição de diâmetro e material, joelho, tê, redução e válvula, portas e conexões, salvar/abrir, desfazer/refazer, validação.

## Fase 2 — Conectividade avançada 🟡

- ✅ Catálogo dimensional de conexões por fabricante/norma, com fontes (`docs/CATALOGS.md`).
- ✅ Famílias editáveis por projeto, com reaplicação às peças existentes.
- ✅ Filtro Y de ferro fundido (Spirax Sarco CI, ASME 125) e flanges com a furação da norma na geometria.
- ✅ Flanges padronizados: tabela única PN 10/16/25/40 (Catálogo Geral, p. 246–249) usada por todas as peças flangeadas PN, com furação e ressalto na geometria; aba "Flanges e tubos flangeados" no Catálogo. Esquema v7.
- ✅ Tubos de ferro fundido dúctil com flanges (flange e flange, flange e ponta em qualquer extremidade, ponta e ponta), com comprimento livre e classe PN 10/16/25/40.
- ✅ Troca de diâmetro que altera só a peça e insere, ajusta ou remove reduções.
- ✅ Tê de redução; extremidades com bolsa, flange ou ponta lisa.
- ✅ Seleção múltipla, mover e copiar por deslocamento; sistemas com cor e visibilidade.
- ✅ Biblioteca de produtos com modelo 3D de catálogo: linha PBA Amanco Wavin completa (tubos classes 12/15/20, curvas, tês, cruzetas, redução, luvas, cap, adaptador DEFoFo, colar de tomada e anéis). Tê e redução PBA da rede usam a mesma geometria.
- ⬜ Inserção na rede dos produtos da biblioteca que ainda não têm tipo de elemento: curvas ponta e bolsa (famílias com extremidades mistas), cruzeta, cap, luvas, adaptador e colar de tomada — exige alteração do esquema.
- ⬜ Peças de transição entre especificações (adaptadores, tocos com flange, luvas de correr).
- ⬜ Verificação de compatibilidade do tipo de extremidade (flange × ponta, bolsa × bolsa).
- ⬜ Snapping avançado (ponto médio, perpendicular, projeção) e manipuladores no viewport.
- ⬜ Seleção por janela; fechamento automático entre duas extremidades.
- ⬜ Catálogo de conexões de PEAD e curvas PBA; catálogos brasileiros de ferro dúctil e válvulas.

## Fase 3 — IFC 🟡

- ✅ Exportação IFC 4.3 (`IFC4X3_ADD2`) no navegador (`@hydrobim/ifc`).
- ✅ Estrutura espacial, portas, `IfcRelConnectsPorts`, sistemas, materiais, propriedades.
- ✅ Georreferência (`IfcProjectedCRS` + `IfcMapConversion`) somente quando informada.
- ✅ Verificação automática: IfcOpenShell abre o arquivo, `validate` sem erros, geometria tesselada.
- ⬜ Testes em visualizadores e ferramentas de autoria de terceiros.
- ⬜ `IfcTypeObject`, conjuntos de propriedades padrão (`Pset_*`), sentido de escoamento.
- ⬜ Sólidos paramétricos para conexões (hoje malhas trianguladas); compatibilidade IFC 4.
- ⬜ Importação IFC.

## Fase 4 — MEP avançado 🟡

- ✅ Níveis/pavimentos e plano de trabalho por nível.
- ✅ Bomba e reservatório (representações genéricas) e ventosa.
- ✅ Projeção ortográfica (planta e elevação em verdadeira grandeza).
- ✅ Quantitativo exportável em CSV.
- ✅ Reservatórios metálicos de catálogo: oito famílias TRAMEC (taça com e sem água na coluna, tubular alto, australiano, vertical apoiado, fundo cônico com pés, montado na obra e cilíndrico horizontal), 113 modelos comerciais tabulados, dimensões personalizadas, origem de cada parâmetro (catálogo × derivado × estimado × usuário), acessórios, bocais adicionais (extravasor, descarga) e exportação IFC com `IfcTankType` e conjuntos de propriedades. Esquema v6.
- ⬜ Reservatórios: divisão interna de células e plataformas desenhadas, bocais verticais (descarga no vértice do cone, respiro), instalação enterrada do horizontal, pesos.
- ⬜ Catálogo de bombas; flanges avulsos como elemento da rede (hoje só no catálogo e nas extremidades das peças), coletores.
- ✅ Planta baixa em traço técnico (projeção do modelo com linhas ocultas removidas), com cotas lineares (alinhada, horizontal, vertical), textos, chamadas e etiquetas de elementos; escala do desenho; exportação em SVG no tamanho físico da escala. Opções de visualização: linhas finas (traço de 1 px na tela em qualquer zoom; a exportação mantém as espessuras de papel) e tema colorido ou preto e branco (o tema acompanha a exportação em SVG).
- ✅ Modelagem pela planta baixa: tubos, joelho, tê, redução, válvula, bomba, reservatório e medição, com prévia do trecho (comprimento, deflexão, desnível). Elevação do eixo acima do nível, herdada da extremidade de partida; alterá-la durante o traçado cria a prumada. Mudanças de direção travadas nos ângulos dos joelhos de catálogo da especificação (também no 3D e na entrada por coordenadas; pode ser destravado).
- ✅ Na planta, Tab alterna entre extremidades sobrepostas sob o cursor; a trava de ângulos também vale ao editar o ângulo de um joelho existente.
- ✅ Somente peças de catálogo (padrão): o editor recusa criar joelho, tê, redução ou válvula de dimensões genéricas e alterar dimensões de peças de catálogo; sem joelho de catálogo, o traçado só prolonga em linha reta. Pode ser desligado nas opções da ferramenta.
- ⬜ Curvas PBA (ponta e bolsa) e conexões de PEAD como famílias, para que essas especificações possam mudar de direção com a política de catálogo ligada.
- ⬜ Modelagem pela planta: declividade do trecho e inserção em linha em tubo vertical.
- ✅ Exportação DXF: planta baixa em R2000, em metros e nas coordenadas do projeto, com camadas `REDE_*` por categoria (cor, tipo e espessura de linha), cotas como `DIMENSION`, conexões/registros/equipamentos como blocos (`INSERT`), contornos em `LWPOLYLINE`, textos, chamadas e etiquetas; modelo 3D em malhas poliface (R12). Conferido com `ezdxf`; ainda não aberto em AutoCAD/Civil 3D.
- ⬜ Planta: balões de item ligados ao quantitativo, cotas de nível, angulares e em cadeia, setas de fluxo, hachuras, seta de norte, linhas de centro e simbologia convencional.
- ⬜ Planta por nível/faixa de corte, cortes e elevações documentados, vistas salvas, pranchas com carimbo e exportação em PDF; no DXF, cotas de nível em `REDE_COTAS_ALTIMETRICAS` (hoje vazia), cotas associativas aos objetos e sólidos 3D.
- ⬜ Persistência em servidor (API + PostgreSQL).

## Fase 5 — Infraestrutura 🟡

- ✅ Georreferência informada pelo usuário.
- ✅ Importação de terreno por pontos XYZ, triangulado (TIN), até 4.000 pontos.
- ✅ Perfil longitudinal com cota do terreno e recobrimento.
- ⬜ Origem de cena deslocada para coordenadas grandes (hoje use coordenadas locais).
- ⬜ Traçado por alinhamento (vértices, deflexões por junta), assentamento por recobrimento.
- ⬜ Cadastro de nós e trechos; descargas, hidrantes, caixas.
- ⬜ Terrenos grandes (LandXML, GeoTIFF) e curvas de nível.

## Fase 6 — Engenharia e integrações 🟡

- ✅ Exportação da rede para o EPANET (INP).
- ✅ Detecção de interferências entre tubos.
- ⬜ Demandas, padrões e perdas localizadas no EPANET; importação de resultados.
- ⬜ Interferências envolvendo conexões e equipamentos; relatórios técnicos.
- ⬜ Federação com outros modelos BIM.

## Próxima etapa recomendada

1. Conferir as famílias com os catálogos vigentes dos fornecedores do projeto e completar o que ficou genérico (PEAD, curvas PBA, ferro dúctil e válvulas de fabricantes brasileiros).
2. Peças de transição e verificação do tipo de extremidade, para que flange e ponta não se conectem sem a peça adequada.
3. Abrir o IFC exportado em visualizadores de terceiros e ajustar o que for necessário.
