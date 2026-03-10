# Copy sound files from Downloads (or Downloads\sounds) to public/sounds
# Place winner.wav, your_turn.wav (or "winner sound.wav", "your turn.wav") in Downloads, then run this script.

$downloads = [Environment]::GetFolderPath("UserProfile") + "\Downloads"
$downloadsSounds = Join-Path $downloads "sounds"
$target = Join-Path $PSScriptRoot "public\sounds"

$files = @(
    @{ src = "winner.wav"; dest = "winner.wav" },
    @{ src = "winner sound.wav"; dest = "winner.wav" },
    @{ src = "winner together.wav"; dest = "winner.wav" },
    @{ src = "chips_betting.wav"; dest = "chips_betting.wav" },
    @{ src = "all in.wav"; dest = "all_in.wav" },
    @{ src = "you lose.wav"; dest = "you_lose.wav" },
    @{ src = "check.wav"; dest = "check.wav" },
    @{ src = "your turn.wav"; dest = "your_turn.wav" },
    @{ src = "your_turn.wav"; dest = "your_turn.wav" },
    @{ src = "shuffle.wav"; dest = "shuffle.wav" },
    @{ src = "card put down.wav"; dest = "card_put_down.wav" },
    @{ src = "card_put_down.wav"; dest = "card_put_down.wav" },
    @{ src = "BACKGROUND_CASINO_AMBIENCE.wav"; dest = "BACKGROUND_CASINO_AMBIENCE.wav" },
    @{ src = "small clap.wav"; dest = "small clap.wav" },
    @{ src = "small_clap.wav"; dest = "small clap.wav" },
    @{ src = "medium reaction.wav"; dest = "medium reaction.wav" },
    @{ src = "medium_reaction.wav"; dest = "medium reaction.wav" },
    @{ src = "big reaction.wav"; dest = "big reaction.wav" },
    @{ src = "big_reaction.wav"; dest = "big reaction.wav" },
    @{ src = "win_checkers or chess.wav"; dest = "win_checkers or chess.wav" },
    @{ src = "lose_checkers or chess.wav"; dest = "lose_checkers or chess.wav" },
    @{ src = "Bot_eliminated.wav"; dest = "Bot_eliminated.wav" },
    @{ src = "checkers or chess select piece.mp3"; dest = "checkers or chess select piece.mp3" },
    @{ src = "chess_piece_place.wav"; dest = "chess_piece_place.wav" },
    @{ src = "piece_place checkers.wav"; dest = "piece_place checkers.wav" },
    @{ src = "choose game coin sound.wav"; dest = "choose game coin sound.wav" },
    @{ src = "message notification.wav"; dest = "message notification.wav" },
    @{ src = "player join room.wav"; dest = "player join room.wav" },
    @{ src = "player or bot joins game.wav"; dest = "player or bot joins game.wav" },
    @{ src = "re-buy.wav"; dest = "re-buy.wav" },
    @{ src = "send message.wav"; dest = "send message.wav" },
    @{ src = "SWAMP_AMBIENCE.wav"; dest = "SWAMP_AMBIENCE.wav" },
    @{ src = "SWAMP_AMBIENCE.mp3"; dest = "SWAMP_AMBIENCE.mp3" },
    @{ src = "swamp_jackpot.wav"; dest = "swamp_jackpot.wav" },
    @{ src = "swamp_jackpot.mp3"; dest = "swamp_jackpot.mp3" },
    @{ src = "slots_lose.wav"; dest = "slots_lose.wav" },
    @{ src = "slots_lose.mp3"; dest = "slots_lose.mp3" }
)

foreach ($f in $files) {
    $srcPath = Join-Path $downloads $f.src
    if (-not (Test-Path $srcPath)) { $srcPath = Join-Path $downloadsSounds $f.src }
    if (Test-Path $srcPath) {
        Copy-Item $srcPath (Join-Path $target $f.dest) -Force
        Write-Host "Copied: $($f.src) -> $($f.dest)"
    }
}

Write-Host "Done. Check public/sounds/ for your files."
