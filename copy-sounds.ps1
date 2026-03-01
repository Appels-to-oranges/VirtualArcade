# Copy sound files from Downloads to public/sounds
# Place winner.wav, your_turn.wav (or "winner sound.wav", "your turn.wav") in Downloads, then run this script.

$downloads = [Environment]::GetFolderPath("UserProfile") + "\Downloads"
$target = Join-Path $PSScriptRoot "public\sounds"

$files = @(
    @{ src = "winner.wav"; dest = "winner.wav" },
    @{ src = "winner sound.wav"; dest = "winner.wav" },
    @{ src = "your turn.wav"; dest = "your_turn.wav" },
    @{ src = "your_turn.wav"; dest = "your_turn.wav" },
    @{ src = "shuffle.wav"; dest = "shuffle.wav" },
    @{ src = "card put down.wav"; dest = "card_put_down.wav" },
    @{ src = "card_put_down.wav"; dest = "card_put_down.wav" },
    @{ src = "BACKGROUND_CASINO_AMBIENCE.wav"; dest = "BACKGROUND_CASINO_AMBIENCE.wav" }
)

foreach ($f in $files) {
    $srcPath = Join-Path $downloads $f.src
    if (Test-Path $srcPath) {
        Copy-Item $srcPath (Join-Path $target $f.dest) -Force
        Write-Host "Copied: $($f.src) -> $($f.dest)"
    }
}

Write-Host "Done. Check public/sounds/ for your files."
