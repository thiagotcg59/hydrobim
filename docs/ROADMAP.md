# Roadmap

Legenda: ✅ concluído e testado · 🟡 parcial · ⬜ não iniciado

## Fase 0 — Fundação ✅ (CI pendente de primeira execução)

- ✅ Monorepo (npm workspaces), TypeScript estrito, ESLint, Prettier, Vitest, Playwright.
- ✅ Frontend React + Vite + Three.js (React Three Fiber) + Zustand.
- ✅ Backend FastAPI + Pydantic (uv, ruff, pytest).
- 🟡 CI (GitHub Actions): workflow configurado (lint, formatação, tipos, testes, build, E2E e backend); **ainda não executado no GitHub**, pois a branch não foi enviada.
- ✅ Documentação técnica e `AGENTS.md`.

## Fase 1 — MVP funcional ✅

- ✅ Viewport 3D com órbita, zoom, deslocamento, grade, eixos e vistas.
- ✅ Tubos por dois pontos em qualquer orientação (mouse ou coordenadas).
- ✅ Seleção, realce e painel de propriedades com dados reais.
- ✅ Alteração de diâmetro e material com atualização da geometria.
- ✅ Joelho, tê, redução e válvula paramétricos (extremidade livre e em linha).
- ✅ Identificadores persistentes, portas e grafo de conexões.
- ✅ Salvar/abrir (navegador e arquivo JSON), desfazer/refazer.
- ✅ Projeto de demonstração, tratamento de erros, validação do modelo.
- ✅ Ferramenta de medição.

Antecipado da Fase 2 por ser necessário à usabilidade: snap em extremidades livres, joelho automático, propagação de diâmetro pelo trecho e reconciliação topológica básica.

## Fase 2 — Conectividade avançada ⬜

- ⬜ Catálogo dimensional de conexões por norma/fabricante (substitui as proporções genéricas).
- ⬜ Peças de transição entre especificações e tês de redução.
- ⬜ Snapping avançado (ponto médio, perpendicular, projeção sobre tubos, planos auxiliares).
- ⬜ Mover/copiar/girar elementos e conjuntos com manipuladores no viewport.
- ⬜ Seleção múltipla e por janela.
- ⬜ Fechamento automático entre duas extremidades (roteamento com joelhos).
- ⬜ Detecção de inconsistências topológicas (trechos isolados, sobreposições).
- ⬜ Camadas de sistemas (vários sistemas por projeto, cores e visibilidade).

## Fase 3 — IFC ⬜

- ⬜ Exportação IFC 4.3 no backend (IfcOpenShell), conforme `IFC_MAPPING.md`.
- ⬜ Geometria válida, propriedades, sistemas, portas e relações.
- ⬜ Testes que reabrem o IFC exportado e conferem entidades e conectividade.
- ⬜ Testes de interoperabilidade em visualizadores e compatibilidade IFC 4.
- ⬜ Integração do botão "Exportar IFC" do editor com a API.

## Fase 4 — MEP avançado ⬜

- ⬜ Níveis e pavimentos; planos de trabalho por nível.
- ⬜ Bombas, reservatórios, coletores, flanges e equipamentos.
- ⬜ Vistas ortográficas (planta, cortes, elevações) com câmera ortográfica.
- ⬜ Quantitativos e listas de materiais exportáveis.
- ⬜ Persistência em servidor (API + PostgreSQL).

## Fase 5 — Infraestrutura ⬜

- ⬜ Coordenadas georreferenciadas e origem de cena deslocada.
- ⬜ Importação de terrenos e superfícies.
- ⬜ Traçado de adutoras por vértices de alinhamento.
- ⬜ Perfil longitudinal, cobrimentos e profundidades de assentamento.
- ⬜ Cadastro de nós e trechos; ventosas, descargas e acessórios de rede.
- ⬜ Transição Infra ↔ MEP (estação elevatória detalhada dentro da adutora).

## Fase 6 — Engenharia e integrações ⬜

- ⬜ Integração com EPANET (exportação/importação de rede).
- ⬜ Relatórios técnicos.
- ⬜ Análise de interferências (avaliar kernel BRep).
- ⬜ Federação com outros modelos BIM (importação IFC).

## Próxima etapa recomendada

Iniciar a Fase 2 pelo **catálogo dimensional de conexões** e pelas **operações de mover/copiar**, que são os maiores limitadores do uso em projetos reais. Em paralelo, a Fase 3 pode começar pelo exportador de tubos (`IfcPipeSegment`) com teste de reabertura no IfcOpenShell, pois o contrato de dados já está estável.
