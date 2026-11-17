# HydroBIM API — validação de projetos e verificação IFC

Serviço FastAPI para validar documentos HydroBIM, sem banco de dados ou persistência.
O contrato segue `packages/core/src/schema.ts`; as regras referenciais e estruturais
seguem `serialization.ts` e `validation.ts` do mesmo pacote.

**O IFC 4.3 é exportado pelo cliente web, no pacote `@hydrobim/ifc`.** A API não
oferece uma rota de exportação: `ifcExport` permanece `false`. A capacidade
`ifcVerification: true` indica a verificação de arquivos nos testes com IfcOpenShell,
não uma rota HTTP de upload/validação IFC. Essa dependência está somente no grupo
`dev`; instalações de produção podem usar `uv sync --no-dev`.

O contrato Python acompanha o esquema 2 do core (famílias, níveis, georreferência,
terreno, bombas, reservatórios e ventosas). Documentos da versão 1 são migrados
em memória com os mesmos defaults de `core/serialization.ts`.

## Instalação e execução

Pré-requisitos: `uv` e Python 3.11 instalado. Execute os comandos nesta pasta
(`services/api/`):

```powershell
uv sync --python 3.11
uv run uvicorn hydrobim_api.main:app --reload --port 8000
```

O `uv.lock` fixa as versões resolvidas. O ambiente `.venv/` fica nesta pasta e é
ignorado pelo Git. `--reload` é destinado ao desenvolvimento; em produção, execute
sem essa opção.

## Testes e estilo

```powershell
uv run pytest
uv run pytest -q
uv run ruff check .
uv run ruff format --check .
```

Os testes incluem todos os arquivos `*.json` diretamente em `<raiz>/examples/`.
Se a pasta não existir ou estiver sem JSONs, esse teste será marcado como ignorado
(`skipped`). Nenhum arquivo de exemplo é modificado.

Antes dos testes IFC, execute `npm run examples:generate` na raiz. O gerador
`tests/tools/generate-ifc.gen.ts` lê os documentos `.hydrobim.json` e grava os
arquivos `.ifc` correspondentes, com timestamp fixo. Os testes reabrem esses arquivos,
verificam o esquema `IFC4X3_ADD2` (inclusive regras EXPRESS), GUIDs, classes, portas,
conexões, unidades e geometria. Na ausência do módulo `ifcopenshell.geom`, somente
o teste de tesselação é ignorado, com motivo explícito. Sem exemplos IFC, os testes
de arquivos são ignorados; isso não equivale a uma exportação verificada.

`ifcopenshell` foi acrescentado ao grupo de desenvolvimento para uma verificação
independente do STEP produzido em TypeScript, sem duplicar o exportador no servidor.
Não há dependência de Blender ou de serviços externos.

## Configuração

As variáveis são lidas ao criar a aplicação; não há segredos ou serviços externos.

| Variável | Padrão | Formato |
| --- | --- | --- |
| `HYDROBIM_CORS_ORIGINS` | `http://localhost:5180` e `http://127.0.0.1:5180` | Array JSON de strings; `[]` desabilita outras origens |
| `HYDROBIM_LOG_LEVEL` | `INFO` | `DEBUG`, `INFO`, `WARNING`, `ERROR` ou `CRITICAL` |

Exemplo em PowerShell:

```powershell
$env:HYDROBIM_CORS_ORIGINS = '["https://hydrobim.exemplo.com"]'
$env:HYDROBIM_LOG_LEVEL = 'INFO'
uv run uvicorn hydrobim_api.main:app --port 8000
```

Os logs da aplicação são JSON em stderr, com contagens de validação e contexto dos
erros. Documentos de projeto não são registrados. Exceções inesperadas retornam
HTTP 500 com `{"detail":"Erro interno do servidor."}`; o traceback fica no servidor.

## Endpoints

| Método | Caminho | Resposta |
| --- | --- | --- |
| `GET` | `/health` | `status`, `service` e versão do pacote instalado |
| `GET` | `/api/v1/capabilities` | `{"projectSchemaVersion":2,"validation":true,"ifcExport":false,"ifcVerification":true}` |
| `POST` | `/api/v1/projects/validate` | Recebe o documento JSON completo e retorna o resultado abaixo |
| `GET` | `/docs` | Documentação OpenAPI interativa |

```json
{
  "valid": true,
  "elementCount": 6,
  "connectionCount": 5,
  "issues": []
}
```

Erros de schema retornam HTTP 422 no formato padrão do FastAPI (`detail` com a
lista de erros). NaN e Infinity são rejeitados; quando aparecem no campo `input`
do erro, são representados como strings para manter a resposta JSON válida.
Campos adicionais são ignorados, como no schema Zod. As propriedades JSON usam
camelCase; os atributos Python usam snake_case e também são aceitos pelo modelo.

Problemas semânticos retornam HTTP 200 com `valid: false` quando houver pelo menos
um erro. Cada item tem `severity`, `code`, `message` em português e `elementIds`.
São verificados IDs duplicados, elementos e portas inexistentes, conexão de um
elemento consigo mesmo, pares de portas duplicados (em qualquer ordem), uso da mesma
porta por conexões diferentes, sistemas inexistentes, tubos menores que `1e-3 m`
e especificações dimensionais inconsistentes (tolerância `1e-6 m`, inclusive a saída
da redução). Portas inválidas usam `DANGLING_CONNECTION`, como no TypeScript.
Conexões distintas reutilizando uma porta são detectadas mesmo se reutilizarem o ID
da conexão. Uma redução com DN igual nas duas extremidades gera apenas o aviso
`REDUCER_SAME_DN`, que não torna o projeto inválido.

Acoplamento geométrico, compatibilidade entre portas e terminais livres coincidentes
não são verificados nesta fase. A validação não altera posições nem normaliza rotações.
