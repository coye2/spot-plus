[CmdletBinding()]
param([switch]$ShowFiles)
$ErrorActionPreference = 'Stop'
$projectDirectory = Split-Path -Parent $PSScriptRoot
$companionPath = Join-Path $projectDirectory 'js/spotplus-spotify.user.js'
$guidePath = Join-Path $projectDirectory 'docs\spotify-helper.md'
if (-not (Test-Path -LiteralPath $companionPath -PathType Leaf)) {
    throw 'The companion is missing. Run the project build first or use the complete Spot+ download.'
}
Write-Host 'Spot+ Spotify account setup (free Spotify accounts)'
Write-Host 'On iPhone: Safari + Userscripts. On Android: Firefox + Tampermonkey.'
Write-Host 'On PC: Chrome, Edge or Firefox + Tampermonkey. Enable Allow User Scripts if required.'
Write-Host 'Install the helper once, click Connect Spotify, sign in on Spotify, then review your library in Spot+.'
Write-Host 'Your Spotify login stays with Spotify; this script does not read credentials.'
Write-Host ('Companion: ' + $companionPath)
Write-Host ('Guide: ' + $guidePath)
if ($ShowFiles) {
    Invoke-Item -LiteralPath (Split-Path -Parent $companionPath)
} else {
    Start-Process 'https://coye2.github.io/spot-plus/#/spotify-account'
}
