<#
  Spot+ bridge setup: updates the repo, checks your Cloudflare token, saves it to GitHub,
  deploys the worker now and confirms it's live. Safe to run again anytime.

  Run from anywhere:
    powershell -ExecutionPolicy Bypass -File "$HOME\spot-plus\scripts\Deploy-Bridge.ps1"
#>
# Continue: Windows PowerShell 5.1 treats normal tool output on stderr as errors under Stop.
$ErrorActionPreference = 'Continue'
$Repo = 'coye2/spot-plus'
$Root = Join-Path $HOME 'spot-plus'
$Health = 'https://spot-plus-canvas.pwr97pnmkn.workers.dev/health'

function Step($text) { Write-Host "`n==> $text" -ForegroundColor Cyan }
function Done($text) { Write-Host "    $text" -ForegroundColor Green }
function Fail($text) { Write-Host "    $text" -ForegroundColor Red; exit 1 }

# This PC's PATH is broken for background command prompts, so use a clean one for this run.
$env:Path = "C:\Windows\System32;C:\Windows;C:\Windows\System32\WindowsPowerShell\v1.0;C:\Program Files\nodejs;C:\Program Files\Git\cmd;C:\Program Files\GitHub CLI;$env:APPDATA\npm"
foreach ($tool in 'git', 'node', 'npm.cmd', 'gh') {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { Fail "$tool is missing. Install it, then run this again." }
}

Step 'Getting the latest Spot+ code'
if (-not (Test-Path $Root)) { git clone "https://github.com/$Repo.git" $Root }
Set-Location $Root
git pull --ff-only
if ($LASTEXITCODE -ne 0) { Fail 'Could not update. If you edited files in this folder, move them out and rerun.' }
Done 'Up to date.'

Step 'Installing Wrangler (Cloudflare''s deploy tool)'
npm.cmd install wrangler --no-save --no-audit --no-fund | Out-Null
$Wrangler = Join-Path $Root 'node_modules\.bin\wrangler.cmd'
if (-not (Test-Path $Wrangler)) { Fail 'Wrangler did not install. Pause antivirus for a minute and run this again.' }
Done 'Ready.'

Step 'Checking GitHub sign-in'
gh auth status 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) { gh auth login --web --git-protocol https }
Done 'Signed in.'

Step 'Cloudflare API token'
Write-Host '    Create one at dash.cloudflare.com > My Profile > API Tokens > Create Token,'
Write-Host '    using the "Edit Cloudflare Workers" template. Paste only the token (input is hidden).'
$secure = Read-Host '    Token' -AsSecureString
$token = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)).Trim()
if ($token.Length -lt 30 -or $token -match '\s') { Fail 'That does not look like an API token. Copy it again and rerun.' }
try {
  $check = Invoke-RestMethod -Uri 'https://api.cloudflare.com/client/v4/user/tokens/verify' -Headers @{ Authorization = "Bearer $token" } -ErrorAction Stop
  if ($check.result.status -ne 'active') { Fail "Cloudflare says this token is $($check.result.status)." }
} catch { Fail 'Cloudflare rejected this token. Make sure it is an API Token, not the Global API Key.' }
Done 'Token is valid.'

Step 'Finding your Cloudflare account'
$env:CLOUDFLARE_API_TOKEN = $token
$who = (& $Wrangler whoami 2>&1) -join "`n"
$accountId = [regex]::Match($who, '[a-f0-9]{32}').Value
if (-not $accountId) { Fail 'Could not read your Account ID. Copy it from the Cloudflare dashboard and add it as the CLOUDFLARE_ACCOUNT_ID secret.' }
$env:CLOUDFLARE_ACCOUNT_ID = $accountId
Done "Account $accountId"

Step 'Saving both secrets to GitHub (for automatic deploys)'
$token | gh secret set CLOUDFLARE_API_TOKEN -R $Repo
$accountId | gh secret set CLOUDFLARE_ACCOUNT_ID -R $Repo
Done 'Saved.'

Step 'Deploying the bridge now'
Push-Location (Join-Path $Root 'canvas-bridge')
& $Wrangler deploy
$deployCode = $LASTEXITCODE
Pop-Location
if ($deployCode -ne 0) { Fail 'Deploy failed. Scroll up for Wrangler''s message.' }

Step 'Checking it''s live'
Start-Sleep -Seconds 5
try { $h = Invoke-RestMethod $Health -ErrorAction Stop; $headers = (Invoke-WebRequest $Health -UseBasicParsing -ErrorAction Stop).Headers } catch { Fail 'The bridge did not answer. Wait a minute and open the health link in a browser.' }
if ($h.status -eq 'ok' -and $h.spotifyPublic -and $headers['X-Frame-Options'] -eq 'DENY') { Done 'Bridge is live with the new security layer.' }
else { Write-Host '    Bridge answered, but the security headers are missing. Wait a minute and check again.' -ForegroundColor Yellow }

Remove-Item Env:CLOUDFLARE_API_TOKEN, Env:CLOUDFLARE_ACCOUNT_ID -ErrorAction SilentlyContinue
$token = $null
Write-Host "`nAll done. Future bridge changes now deploy automatically from GitHub." -ForegroundColor Green
