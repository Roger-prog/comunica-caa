param([string]$SupabaseUrl, [string]$PublishableKey, [string]$TurnstileSiteKey)
$ErrorActionPreference = 'Stop'
if (-not $SupabaseUrl) { $SupabaseUrl = Read-Host 'URL do projeto Supabase (https://...supabase.co)' }
if (-not $PublishableKey) { $PublishableKey = Read-Host 'Chave PUBLICA publishable (nunca secret/service_role)' }
$SupabaseUrl = $SupabaseUrl.Trim().TrimEnd('/')
$PublishableKey = $PublishableKey.Trim()
$projectUri = $null
if (-not [Uri]::TryCreate($SupabaseUrl, [UriKind]::Absolute, [ref]$projectUri) -or $projectUri.Scheme -ne 'https' -or -not $projectUri.Host) { throw 'URL HTTPS invalida.' }
$publicKeyValid = $PublishableKey.StartsWith('sb_publishable_')
if (-not $publicKeyValid) {
  try {
    $payload = $PublishableKey.Split('.')[1].Replace('-', '+').Replace('_', '/')
    $payload = $payload.PadRight($payload.Length + ((4 - $payload.Length % 4) % 4), '=')
    $claims = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($payload)) | ConvertFrom-Json
    $publicKeyValid = $claims.role -eq 'anon'
  } catch { $publicKeyValid = $false }
}
if (-not $publicKeyValid) { throw 'Use somente a chave publishable ou a chave legada anon. Nao use secret, service_role ou senha do banco.' }
$configPath = Join-Path $PSScriptRoot 'web/config.json'
$previousConfig = @{}
if (Test-Path -LiteralPath $configPath) { $previousConfig = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json }
if (-not $PSBoundParameters.ContainsKey('TurnstileSiteKey')) { $TurnstileSiteKey = $previousConfig.turnstileSiteKey }
$TurnstileSiteKey = ([string]$TurnstileSiteKey).Trim()
if ($TurnstileSiteKey -and $TurnstileSiteKey -notmatch '^0x[0-9A-Za-z_-]{20,30}$') { throw 'Informe apenas a Site key publica do Turnstile, nunca a Secret key.' }
$siteConfig = @{
  supabaseUrl=$SupabaseUrl
  supabasePublishableKey=$PublishableKey
  turnstileSiteKey=$TurnstileSiteKey
  emailRecoveryEnabled=($previousConfig.emailRecoveryEnabled -eq $true)
} | ConvertTo-Json
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[IO.File]::WriteAllText($configPath, $siteConfig, $utf8NoBom)
$compiledDir = Join-Path $PSScriptRoot 'site-compilado'
if (-not (Test-Path -LiteralPath (Join-Path $compiledDir 'index.html'))) { $compiledDir = Join-Path $PSScriptRoot 'build/web' }
if (-not (Test-Path -LiteralPath (Join-Path $compiledDir 'index.html'))) { throw 'Configuracao salva em web/config.json. Compile com flutter build web --release --no-web-resources-cdn e execute este script novamente.' }
[IO.File]::WriteAllText((Join-Path $compiledDir 'config.json'), $siteConfig, $utf8NoBom)
Compress-Archive -Path (Join-Path $compiledDir '*') -DestinationPath (Join-Path $PSScriptRoot 'comunica-site-configurado.zip') -Force
Write-Host 'Pronto: publique comunica-site-configurado.zip no Cloudflare Pages. Execute antes o SQL no Supabase.'
