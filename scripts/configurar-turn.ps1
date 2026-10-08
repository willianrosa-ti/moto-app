# Recebe a chave pelo terminal e a guarda protegida pelo usuário do Windows.
# Nenhuma chave é impressa ou incluída no Git.
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Write-Host 'Cloudflare Realtime > TURN > Create TURN key'
Write-Host 'Use o nome MIL-LIN Radio. Copie os dois campos da chave criada.'
$keyId = (Read-Host 'TURN Key ID').Trim()
if ($keyId -notmatch '^[a-zA-Z0-9_-]{16,128}$') { throw 'TURN Key ID inválido.' }
$secret = Read-Host 'API Token da chave TURN (entrada oculta)' -AsSecureString
$plain = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
try {
    $token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($plain)
    $result = Invoke-RestMethod -Method Post -Uri "https://rtc.live.cloudflare.com/v1/turn/keys/$keyId/credentials/generate-ice-servers" -Headers @{ Authorization="Bearer $token" } -ContentType 'application/json' -Body '{"ttl":3600}'
    if (!$result.iceServers) { throw 'Cloudflare não retornou servidores de voz.' }
    $dir = Join-Path $root '.expo/radio-20261008'
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
    @{ keyId=$keyId; encryptedToken=($secret | ConvertFrom-SecureString) } | ConvertTo-Json | Set-Content (Join-Path $dir 'cloudflare-turn.local.json') -Encoding UTF8
    Write-Host 'Chave validada e salva com proteção do Windows. Pode avisar no chat: chave TURN configurada.' -ForegroundColor Green
} catch {
    Write-Host 'Não foi possível validar. Confira se copiou o TURN Key ID e o API Token da mesma chave.' -ForegroundColor Red
    exit 1
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($plain)
    $token = $null
}
