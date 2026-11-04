# Run at sign-in by the "EqDownload Home" scheduled task.
# Updates yt-dlp, starts the server, opens a Cloudflare quick tunnel and writes its address to address.txt.
# The address changes every start. The server asks for the access key (access.key) on every tunnel request.
$ErrorActionPreference = 'Continue'
$h = $PSScriptRoot
$py = Join-Path $h '.venv\Scripts\python.exe'
$pyw = Join-Path $h '.venv\Scripts\pythonw.exe'
$log = Join-Path $h 'tunnel.log'

function Test-Server { try { (Invoke-WebRequest -UseBasicParsing 'http://localhost:8765/' -TimeoutSec 3).StatusCode -eq 200 } catch { $false } }

if (-not (Test-Server)) {
    & $py -m pip install -q --upgrade yt-dlp
    Start-Process -WindowStyle Hidden $pyw -ArgumentList 'server.py' -WorkingDirectory $h
    1..20 | ForEach-Object { if (-not (Test-Server)) { Start-Sleep 1 } }
}

Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force
Remove-Item $log -ErrorAction SilentlyContinue
Start-Process -WindowStyle Hidden cloudflared -ArgumentList 'tunnel', '--no-autoupdate', '--url', 'http://localhost:8765' -RedirectStandardError $log

$addr = $null
1..60 | ForEach-Object {
    if (-not $addr -and (Test-Path $log)) {
        $m = Select-String -Path $log -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($m) { $addr = $m.Matches[0].Value }
    }
    if (-not $addr) { Start-Sleep 1 }
}
if (-not $addr) { exit 1 }

$file = Join-Path $h 'address.txt'
Set-Content -Path $file -Value $addr -Encoding ascii
