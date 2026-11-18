# Inicia o editor HydroBIM (http://localhost:5180) e, ao encerrar a sessão,
# publica o trabalho no GitHub.
#
# Uso, no PowerShell, dentro da pasta do projeto:
#   .\iniciar.ps1                 abre o editor; ao encerrar, verifica e envia
#   .\iniciar.ps1 -SemEnviar      abre o editor sem enviar nada ao encerrar
#   .\iniciar.ps1 -SomenteEnviar  não abre o editor; só verifica e envia
#
# Para encerrar a sessão: pressione Q nesta janela. O Ctrl+C também fecha o
# editor, mas pula o envio (é a saída de emergência).
#
# Regras do envio (AGENTS.md, "Convenções Git"):
#   - só da branch de trabalho (feature/...), nunca direto na main/develop;
#   - só com `npm run check` passando (lint, tipos, testes e build);
#   - alterações sem commit só entram com mensagem no padrão Conventional
#     Commits digitada por você; nada é commitado com mensagem genérica.

param(
    [switch]$SemEnviar,
    [switch]$SomenteEnviar
)

$ErrorActionPreference = 'Stop'
$raiz = $PSScriptRoot
$porta = 5180
$repositorio = 'https://github.com/thiagotcg59/hydrobim'
$padraoCommit = '^(feat|fix|docs|test|chore|refactor|ci|perf|style|build)(\([a-z0-9-]+\))?!?: .+'

function Exigir($comando, $comoInstalar) {
    if (-not (Get-Command $comando -ErrorAction SilentlyContinue)) {
        Write-Host "Falta o programa '$comando'. $comoInstalar" -ForegroundColor Red
        exit 1
    }
}

function PortaOcupada($numero) {
    $cliente = New-Object System.Net.Sockets.TcpClient
    try { $cliente.Connect('localhost', $numero); return $true }
    catch { return $false }
    finally { $cliente.Close() }
}

function Titulo($texto) {
    Write-Host ''
    Write-Host $texto -ForegroundColor Cyan
}

function Publicar {
    Push-Location $raiz
    try {
        Titulo '== Publicação no GitHub =='

        $branch = (git branch --show-current).Trim()
        if (-not $branch) {
            Write-Host 'O repositório não está em nenhuma branch (HEAD destacado). Nada foi enviado.' -ForegroundColor Red
            return
        }
        if ($branch -in 'main', 'develop') {
            Write-Host "Você está na branch '$branch'. O envio automático só sai de branches de trabalho" -ForegroundColor Yellow
            Write-Host '(feature/...); main e develop recebem alterações por pull request. Nada foi enviado.' -ForegroundColor Yellow
            return
        }

        $pendentes = @(git status --porcelain)
        $mensagem = ''
        if ($pendentes.Count -gt 0) {
            Write-Host "Há $($pendentes.Count) arquivo(s) alterado(s) sem commit:" -ForegroundColor Yellow
            $pendentes | Select-Object -First 25 | ForEach-Object { Write-Host "  $_" }
            if ($pendentes.Count -gt 25) { Write-Host "  ... e mais $($pendentes.Count - 25)" }
            Write-Host ''
            Write-Host 'Digite a mensagem do commit (ex.: feat(web): ferramenta de cotas)' -ForegroundColor Yellow
            Write-Host 'ou apenas Enter para deixar esses arquivos de fora e enviar só os commits já feitos.' -ForegroundColor Yellow
            while ($true) {
                $mensagem = (Read-Host 'Mensagem').Trim()
                if (-not $mensagem -or $mensagem -match $padraoCommit) { break }
                Write-Host 'A mensagem precisa seguir o padrão "tipo(escopo): descrição" — tipos: feat, fix, docs, test, chore, refactor, ci, perf, style, build.' -ForegroundColor Red
            }
        }

        # Envia só se houver o que enviar: commits novos ou alterações a commitar.
        $temUpstream = $true
        git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>$null | Out-Null
        if ($LASTEXITCODE -ne 0) { $temUpstream = $false }
        $aFrente = if ($temUpstream) { [int](git rev-list --count '@{u}..HEAD') } else { 1 }
        if ($aFrente -eq 0 -and -not $mensagem) {
            Write-Host 'Nada novo para enviar: o GitHub já está atualizado.' -ForegroundColor Green
            return
        }

        Titulo 'Verificando antes de enviar (lint, tipos, testes e build)... pode levar alguns minutos.'
        npm run check
        if ($LASTEXITCODE -ne 0) {
            Write-Host ''
            Write-Host 'A verificação falhou. NADA foi commitado nem enviado.' -ForegroundColor Red
            Write-Host 'Corrija os erros acima e rode .\iniciar.ps1 -SomenteEnviar.' -ForegroundColor Red
            return
        }

        if ($mensagem) {
            git add -A
            git commit -m $mensagem
            if ($LASTEXITCODE -ne 0) {
                Write-Host 'O commit falhou. Nada foi enviado.' -ForegroundColor Red
                return
            }
        }

        Titulo "Enviando a branch '$branch' para o GitHub..."
        if ($temUpstream) { git push } else { git push -u origin $branch }
        if ($LASTEXITCODE -ne 0) {
            Write-Host 'O envio falhou (veja a mensagem acima). Confira o login com: gh auth status' -ForegroundColor Red
            return
        }

        $ultimo = (git rev-parse HEAD).Trim()
        Write-Host ''
        Write-Host 'Enviado!' -ForegroundColor Green
        Write-Host "  Commit:        $repositorio/commit/$ultimo"
        Write-Host "  CI (testes):   $repositorio/actions"
        Write-Host "  Pull request:  $repositorio/compare/develop...$($branch)?expand=1"
    }
    finally {
        Pop-Location
    }
}

Exigir 'npm' 'Instale o Node.js 22 em https://nodejs.org/ e abra o PowerShell de novo.'
Exigir 'git' 'Instale o Git em https://git-scm.com/ e abra o PowerShell de novo.'

if ($SomenteEnviar) {
    Publicar
    exit 0
}

if (PortaOcupada $porta) {
    Write-Host "A porta $porta já está em uso. O HydroBIM já está aberto em outra janela? Feche-a e tente de novo." -ForegroundColor Red
    exit 1
}

Titulo '1/2 Conferindo as dependências...'
Push-Location $raiz
$instalado = 'node_modules\.package-lock.json'
$desatualizado = (-not (Test-Path $instalado)) -or
    ((Get-Item 'package-lock.json').LastWriteTime -gt (Get-Item $instalado).LastWriteTime)
if ($desatualizado) {
    npm ci --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { Pop-Location; exit 1 }
}
Pop-Location

Titulo '2/2 Iniciando o editor...'
$servidor = Start-Process -FilePath 'npm.cmd' -ArgumentList 'run', 'dev', '--', '--open' `
    -WorkingDirectory $raiz -NoNewWindow -PassThru

$encerrouPorQ = $false
try {
    $pronto = $false
    foreach ($tentativa in 1..120) {
        if ($servidor.HasExited) { break }
        if (PortaOcupada $porta) { $pronto = $true; break }
        Start-Sleep -Milliseconds 500
    }
    if (-not $pronto) {
        Write-Host 'O editor não iniciou. Veja a mensagem de erro acima.' -ForegroundColor Red
        exit 1
    }

    Write-Host ''
    Write-Host "Pronto! HydroBIM em http://localhost:$porta" -ForegroundColor Green
    if ($SemEnviar) {
        Write-Host 'Pressione Q para encerrar a sessão (sem enviar ao GitHub).' -ForegroundColor Green
    } else {
        Write-Host 'Pressione Q para encerrar a sessão e enviar o trabalho ao GitHub.' -ForegroundColor Green
    }
    Write-Host ''

    while (-not $servidor.HasExited) {
        if ([Console]::KeyAvailable) {
            $tecla = [Console]::ReadKey($true)
            if ($tecla.Key -eq 'Q') { $encerrouPorQ = $true; break }
        }
        Start-Sleep -Milliseconds 200
    }
}
finally {
    if ($servidor -and -not $servidor.HasExited) {
        # /T encerra também os processos filhos (node do Vite).
        taskkill /PID $servidor.Id /T /F | Out-Null
    }
    Write-Host 'Editor encerrado.'
}

if ($encerrouPorQ -and -not $SemEnviar) {
    Publicar
}
