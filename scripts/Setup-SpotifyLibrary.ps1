<#
.SYNOPSIS
Opens Spotify's data-request page or prepares a music-only Spot+ import file.
.EXAMPLE
.\Setup-SpotifyLibrary.ps1 -RequestData
.EXAMPLE
.\Setup-SpotifyLibrary.ps1 -SpotifyExport 'C:\Downloads\my_spotify_data.zip'
#>
[CmdletBinding()]
param(
  [string[]]$SpotifyExport,
  [string]$OutputFile,
  [switch]$RequestData
)
$ErrorActionPreference = 'Stop'
if ($RequestData) {
  Start-Process 'https://www.spotify.com/account/privacy/'
  Write-Host 'Request Account data on Spotify. Spotify handles sign-in and prepares your download.'
  Write-Host 'When it arrives, run this script with -SpotifyExport and the downloaded ZIP path.'
  if (-not $SpotifyExport) { return }
}
if (-not $SpotifyExport) {
  Add-Type -AssemblyName System.Windows.Forms
  $picker = New-Object System.Windows.Forms.OpenFileDialog
  $picker.Title = 'Choose your Spotify Account data ZIP or music JSON files'
  $picker.Filter = 'Spotify export (*.zip;*.json)|*.zip;*.json'
  $picker.Multiselect = $true
  if ($picker.ShowDialog() -ne 'OK') { $picker.Dispose(); return }
  $SpotifyExport = $picker.FileNames
  $picker.Dispose()
}
Add-Type -AssemblyName System.IO.Compression.FileSystem
$musicDocuments = New-Object 'System.Collections.Generic.List[object]'
function Add-MusicDocument([string]$Name, [string]$Json) {
  $data = $Json | ConvertFrom-Json
  # Copy only music metadata. Other account-export data never reaches the output.
  if ($null -ne $data.tracks) {
    $tracks = @($data.tracks | Where-Object { $_.track -and $_.artist } | ForEach-Object {
      @{ track=[string]$_.track; artist=[string]$_.artist; album=[string]$_.album; uri=[string]$_.uri }
    })
    $musicDocuments.Add(@{name=$Name; data=@{tracks=$tracks}})
  }
  if ($null -ne $data.playlists) {
    $playlists = @($data.playlists | ForEach-Object {
      $playlist = $_
      $items = @($playlist.items | Where-Object { $_.track.trackName -and $_.track.artistName } | ForEach-Object {
        @{track=@{trackName=[string]$_.track.trackName; artistName=[string]$_.track.artistName; albumName=[string]$_.track.albumName; trackUri=[string]$_.track.trackUri}}
      })
      @{name=[string]$playlist.name; lastModifiedDate=[string]$playlist.lastModifiedDate; uri=[string]$playlist.uri; items=$items}
    })
    $musicDocuments.Add(@{name=$Name; data=@{playlists=$playlists}})
  }
}
$totalMusicBytes = 0L
$entryCount = 0
foreach ($selected in $SpotifyExport) {
  $resolved = (Resolve-Path -LiteralPath $selected).Path
  $file = Get-Item -LiteralPath $resolved
  if ($file.Length -gt 80MB) { throw 'Choose the Account data ZIP under 80 MB, or individual music JSON files.' }
  if ($file.Extension -ieq '.zip') {
    $archive = [System.IO.Compression.ZipFile]::OpenRead($resolved)
    try {
      foreach ($entry in $archive.Entries) {
        if ($entry.FullName -notmatch '(?i)(^|[/\\])(YourLibrary|Playlist\d*|Playlists)\.json$') { continue }
        $totalMusicBytes += $entry.Length
        $entryCount++
        if ($entry.Length -gt 20MB -or $totalMusicBytes -gt 50MB -or $entryCount -gt 100) { throw 'The music export is too large. Choose individual music JSON files.' }
        $reader = New-Object System.IO.StreamReader($entry.Open())
        try { Add-MusicDocument $entry.Name $reader.ReadToEnd() } finally { $reader.Dispose() }
      }
    } finally { $archive.Dispose() }
  } elseif ($file.Extension -ieq '.json') {
    if ($file.Length -gt 20MB) { throw 'Choose an individual music JSON file under 20 MB.' }
    Add-MusicDocument $file.Name ([System.IO.File]::ReadAllText($resolved))
  } else { throw 'Choose a Spotify ZIP or JSON file.' }
}
if ($musicDocuments.Count -eq 0) { throw 'No music library found. Choose YourLibrary.json, Playlist*.json, or the Account data ZIP.' }
if (-not $OutputFile) { $OutputFile = Join-Path (Split-Path -Parent (Resolve-Path -LiteralPath $SpotifyExport[0]).Path) ('spotplus-spotify-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.json') }
$destination = [System.IO.Path]::GetFullPath($OutputFile)
if (Test-Path -LiteralPath $destination) { throw 'The output file already exists. Choose a different -OutputFile name.' }
$payload = @{ app='spotplus-spotify-export'; version=1; documents=@($musicDocuments.ToArray()) } | ConvertTo-Json -Depth 20
[System.IO.File]::WriteAllText($destination, $payload, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "Ready: $destination"
Write-Host 'In Spot+, open Spotify collections > Import my Spotify data and select this file.'
Write-Host 'You can also import the original Spotify ZIP directly on your phone. A PC is not required.'
