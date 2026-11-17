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
- ✅ Troca de diâmetro que altera só a peça e insere, ajusta ou remove reduções.
- ✅ Tê de redução; extremidades com bolsa, flange ou ponta lisa.
- ✅ Seleção múltipla, mover e copiar por deslocamento; sistemas com cor e visibilidade.
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
- ⬜ Catálogo de bombas e reservatórios; flanges avulsos, coletores.
- ⬜ Cortes, vistas salvas e pranchas.
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
