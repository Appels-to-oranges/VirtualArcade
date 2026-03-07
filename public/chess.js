(function () {
  'use strict';

  var PIECE_PATH = '/chess/';
  var MOVE_SFX = new Audio('/checker-move.ogg');
  var CAPTURE_SFX = new Audio('/checker-capture.ogg');

  function playChessPiecePlaceSfx() {
    if (typeof playChessPiecePlace === 'function') playChessPiecePlace();
    else playChessSound(MOVE_SFX);
  }

  /* ── State ── */

  var chWs = null;
  var chMyId = null;
  var chMyColor = null;
  var chBoard = null;
  var chTurn = null;
  var chSelected = null;
  var chValidMoves = [];
  var chGameState = 'waiting';
  var chPlayers = [];
  var chWinner = null;
  var chRoomKey = '';
  var chTimerSeconds = 0;
  var chTurnDeadline = 0;
  var chTimerInterval = null;
  var chTimeLowAlertPlayed = false;
  var chCapturesWhite = 0;
  var chWagerProposals = {};
  var chWagerReady = {};
  var chWagerLocked = {};
  var chWagerChips = {};
  var chWagerNicknames = {};
  var chWagerAmount = 0;
  var chCapturesBlack = 0;
  var chCastling = null;
  var chEnPassant = null;
  var chLastMove = null;
  var chInCheck = false;

  /* ── DOM refs (lazy) ── */

  var screenEl = null;
  var boardEl = null;
  var statusEl = null;
  var roomLabelEl = null;
  var playersAreaEl = null;
  var stylesInjected = false;

  /* ── Helpers ── */

  function emptyBoard() {
    return Array.from({ length: 8 }, function () { return Array(8).fill(null); });
  }

  function send(obj) {
    if (chWs && chWs.readyState === WebSocket.OPEN) {
      chWs.send(JSON.stringify(obj));
    }
  }

  function setStatus(text) {
    if (statusEl) statusEl.textContent = text;
  }

  function pieceImg(piece) {
    return PIECE_PATH + piece.color + '_' + piece.type + '.png';
  }

  function playChessSound(audio) {
    var vol = parseInt(localStorage.getItem('poker_card_fx_volume'), 10);
    var volNorm = (isNaN(vol) ? 80 : Math.max(0, Math.min(100, vol))) / 100;
    if (typeof playSfx === 'function') {
      playSfx(audio, volNorm);
    } else {
      try { audio.volume = volNorm; audio.currentTime = 0; audio.play(); } catch (_) {}
    }
  }

  function playCheckAlert() {
    try {
      var ctx = (typeof getAudioCtx === 'function') ? getAudioCtx() : new (window.AudioContext || window.webkitAudioContext)();
      var vol = parseInt(localStorage.getItem('poker_card_fx_volume'), 10);
      var v = ((isNaN(vol) ? 80 : Math.max(0, Math.min(100, vol))) / 100) * 0.3;
      for (var i = 0; i < 2; i++) {
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'square';
        osc.frequency.setValueAtTime(880, ctx.currentTime + i * 0.12);
        gain.gain.setValueAtTime(v, ctx.currentTime + i * 0.12);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + i * 0.12 + 0.08);
        osc.start(ctx.currentTime + i * 0.12);
        osc.stop(ctx.currentTime + i * 0.12 + 0.08);
      }
    } catch (_) {}
  }

  /* ── Attack detection ── */

  function isSquareAttacked(board, row, col, byColor) {
    var pawnDir = byColor === 'white' ? -1 : 1;
    var pr = row - pawnDir;
    var dc, pc, pp;
    for (dc = -1; dc <= 1; dc += 2) {
      pc = col + dc;
      if (pr >= 0 && pr < 8 && pc >= 0 && pc < 8) {
        pp = board[pr][pc];
        if (pp && pp.type === 'pawn' && pp.color === byColor) return true;
      }
    }
    var knightOff = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
    var ki, knr, knc, kp;
    for (ki = 0; ki < knightOff.length; ki++) {
      knr = row + knightOff[ki][0]; knc = col + knightOff[ki][1];
      if (knr >= 0 && knr < 8 && knc >= 0 && knc < 8) {
        kp = board[knr][knc];
        if (kp && kp.type === 'knight' && kp.color === byColor) return true;
      }
    }
    var dirs = [[-1,-1],[-1,1],[1,-1],[1,1]];
    var di, dd, dnr, dnc, dp;
    for (di = 0; di < dirs.length; di++) {
      for (dd = 1; dd < 8; dd++) {
        dnr = row + dirs[di][0] * dd; dnc = col + dirs[di][1] * dd;
        if (dnr < 0 || dnr >= 8 || dnc < 0 || dnc >= 8) break;
        dp = board[dnr][dnc];
        if (dp) {
          if (dp.color === byColor && (dp.type === 'bishop' || dp.type === 'queen')) return true;
          break;
        }
      }
    }
    var orthDirs = [[-1,0],[1,0],[0,-1],[0,1]];
    var oi, od, onr, onc, op;
    for (oi = 0; oi < orthDirs.length; oi++) {
      for (od = 1; od < 8; od++) {
        onr = row + orthDirs[oi][0] * od; onc = col + orthDirs[oi][1] * od;
        if (onr < 0 || onr >= 8 || onc < 0 || onc >= 8) break;
        op = board[onr][onc];
        if (op) {
          if (op.color === byColor && (op.type === 'rook' || op.type === 'queen')) return true;
          break;
        }
      }
    }
    var kingDirs = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
    var kki, kknr, kknc, kkp;
    for (kki = 0; kki < kingDirs.length; kki++) {
      kknr = row + kingDirs[kki][0]; kknc = col + kingDirs[kki][1];
      if (kknr >= 0 && kknr < 8 && kknc >= 0 && kknc < 8) {
        kkp = board[kknr][kknc];
        if (kkp && kkp.type === 'king' && kkp.color === byColor) return true;
      }
    }
    return false;
  }

  function isInCheck(board, color) {
    var opp = color === 'white' ? 'black' : 'white';
    for (var r = 0; r < 8; r++) {
      for (var c = 0; c < 8; c++) {
        if (board[r][c] && board[r][c].type === 'king' && board[r][c].color === color) {
          return isSquareAttacked(board, r, c, opp);
        }
      }
    }
    return true;
  }

  /* ── Move generation (client-side, for highlighting) ── */

  function cloneBoard(b) {
    return b.map(function (row) {
      return row.map(function (cell) { return cell ? { type: cell.type, color: cell.color } : null; });
    });
  }

  function getPseudoMoves(board, row, col) {
    var piece = board[row][col];
    if (!piece) return [];
    var moves = [];
    var color = piece.color;
    var type = piece.type;
    var nr, nc, i, d, dirs;

    if (type === 'pawn') {
      var dir = color === 'white' ? -1 : 1;
      var startRow = color === 'white' ? 6 : 1;
      nr = row + dir;
      if (nr >= 0 && nr < 8 && !board[nr][col]) {
        moves.push({ row: nr, col: col });
        var nr2 = row + 2 * dir;
        if (row === startRow && nr2 >= 0 && nr2 < 8 && !board[nr2][col]) {
          moves.push({ row: nr2, col: col });
        }
      }
      for (d = -1; d <= 1; d += 2) {
        nc = col + d;
        if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8 && board[nr][nc] && board[nr][nc].color !== color) {
          moves.push({ row: nr, col: nc, captured: true });
        }
      }
    } else if (type === 'knight') {
      var koff = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
      for (i = 0; i < koff.length; i++) {
        nr = row + koff[i][0]; nc = col + koff[i][1];
        if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8 && (!board[nr][nc] || board[nr][nc].color !== color)) {
          moves.push({ row: nr, col: nc, captured: !!board[nr][nc] });
        }
      }
    } else if (type === 'bishop' || type === 'queen' || type === 'rook' || type === 'king') {
      dirs = [];
      if (type !== 'rook') dirs = dirs.concat([[-1,-1],[-1,1],[1,-1],[1,1]]);
      if (type !== 'bishop') dirs = dirs.concat([[-1,0],[1,0],[0,-1],[0,1]]);
      var limit = type === 'king' ? 1 : 7;
      for (d = 0; d < dirs.length; d++) {
        for (i = 1; i <= limit; i++) {
          nr = row + dirs[d][0] * i; nc = col + dirs[d][1] * i;
          if (nr < 0 || nr >= 8 || nc < 0 || nc >= 8) break;
          if (board[nr][nc]) {
            if (board[nr][nc].color !== color) moves.push({ row: nr, col: nc, captured: true });
            break;
          }
          moves.push({ row: nr, col: nc });
        }
      }
    }
    return moves;
  }

  function getValidMoves(board, row, col, color) {
    var piece = board[row][col];
    if (!piece || piece.color !== color) return [];
    var pseudo = getPseudoMoves(board, row, col);
    var opp = color === 'white' ? 'black' : 'white';
    var kingRow = color === 'white' ? 7 : 0;

    if (piece.type === 'pawn' && chEnPassant) {
      var epDir = color === 'white' ? -1 : 1;
      if (row + epDir === chEnPassant.row && Math.abs(col - chEnPassant.col) === 1) {
        pseudo.push({ row: chEnPassant.row, col: chEnPassant.col, captured: true, enPassant: true });
      }
    }

    if (piece.type === 'king' && chCastling) {
      var rights = chCastling[color];
      if (rights && row === kingRow && col === 4 && !isInCheck(board, color)) {
        if (rights.kingSide && !board[kingRow][5] && !board[kingRow][6] &&
            board[kingRow][7] && board[kingRow][7].type === 'rook' && board[kingRow][7].color === color &&
            !isSquareAttacked(board, kingRow, 5, opp) && !isSquareAttacked(board, kingRow, 6, opp)) {
          pseudo.push({ row: kingRow, col: 6, castle: 'kingside' });
        }
        if (rights.queenSide && !board[kingRow][3] && !board[kingRow][2] && !board[kingRow][1] &&
            board[kingRow][0] && board[kingRow][0].type === 'rook' && board[kingRow][0].color === color &&
            !isSquareAttacked(board, kingRow, 3, opp) && !isSquareAttacked(board, kingRow, 2, opp)) {
          pseudo.push({ row: kingRow, col: 2, castle: 'queenside' });
        }
      }
    }

    var legal = [];
    for (var i = 0; i < pseudo.length; i++) {
      var m = pseudo[i];
      var test = cloneBoard(board);
      test[m.row][m.col] = { type: piece.type, color: color };
      test[row][col] = null;
      if (m.enPassant) test[row][m.col] = null;
      if (m.castle) {
        if (m.castle === 'kingside') { test[kingRow][5] = test[kingRow][7]; test[kingRow][7] = null; }
        else { test[kingRow][3] = test[kingRow][0]; test[kingRow][0] = null; }
      }
      if (piece.type === 'pawn' && m.row === (color === 'white' ? 0 : 7)) {
        test[m.row][m.col] = { type: 'queen', color: color };
      }
      if (!isInCheck(test, color)) legal.push(m);
    }
    return legal;
  }

  /* ── Style injection ── */

  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;

    var s = document.createElement('style');
    s.id = 'ch-styles';
    s.textContent =
      '#ch-screen{position:fixed;inset:0;background:#0a0a0a;z-index:1;' +
        'display:flex;flex-direction:column;align-items:center;' +
        "font-family:'Press Start 2P',monospace;color:#ddd;overflow:hidden}" +

      '#ch-screen .ch-room-bar{width:100%;display:flex;align-items:center;' +
        'justify-content:center;flex-wrap:wrap;gap:.75rem;padding:.4rem .75rem;' +
        'background:#111;border-bottom:.2rem solid #1a1a1a;flex-shrink:0}' +
      '.ch-room-bar-spacer{flex:1;min-width:.5rem}' +

      '#ch-room-label{font-size:.6rem;color:#666;letter-spacing:.0625rem}' +

      '#ch-screen .btn-start,#ch-screen .btn-restart{' +
        "font-family:'Press Start 2P',monospace;" +
        'font-size:.45rem;padding:.35rem .75rem;border:none;border-radius:.25rem;' +
        'cursor:pointer;text-transform:uppercase;letter-spacing:.05rem}' +
      '#ch-screen .btn-start{background:#238636;color:#fff}' +
      '#ch-screen .btn-start:hover{background:#2ea043}' +
      '#ch-screen .btn-start:disabled{background:#2a2a2a;border-color:#444;color:#555;cursor:not-allowed}' +
      '#ch-screen .btn-restart{background:#1b4332;color:#ddd;border:.125rem solid #40916c}' +
      '#ch-screen .btn-restart:hover{background:#2d6a4f}' +

      '#ch-status{font-size:.65rem;color:#c9b896;text-transform:uppercase;' +
        'letter-spacing:.1rem;text-align:center;padding:.4rem .5rem;flex-shrink:0}' +

      '#ch-players-area{display:flex;gap:1rem;justify-content:center;' +
        'align-items:center;padding:.25rem .5rem;flex-shrink:0}' +

      '.ch-player-tag{display:flex;align-items:center;gap:.4rem;padding:.3rem .6rem;' +
        'border:.125rem solid #30363d;background:rgba(13,17,23,.6);font-size:.5rem}' +

      '.ch-player-tag.ch-turn{border-color:#ffd700;' +
        'box-shadow:0 0 .5rem rgba(255,215,0,.3)}' +

      '.ch-player-tag.ch-is-me{background:color-mix(in srgb, var(--lobby-accent) 30%, transparent)}' +

      '.ch-player-swatch{width:.7rem;height:.7rem;border:.0625rem solid #555;flex-shrink:0}' +

      '.ch-color-black{background:#333}' +
      '.ch-color-white{background:#eee}' +

      '.ch-player-name{color:#ddd}' +
      '.ch-captures{color:#888;font-size:.4rem;margin-left:.25rem}' +
      '.ch-chips-display{font-size:.5rem;color:#c9b896;padding:.2rem .4rem;background:#1a1a1a;border:.1rem solid #333;border-radius:.2rem}' +

      '.ch-board-wrap{flex:1;display:flex;align-items:center;justify-content:center;' +
        'min-height:0;padding:.5rem}' +

      '#ch-board{' +
        '--ch-size:min(calc(100vh - 9rem),calc(100vw - 2rem),42rem);' +
        'display:grid;grid-template-columns:repeat(8,1fr);grid-template-rows:repeat(8,1fr);' +
        'width:var(--ch-size);height:var(--ch-size);gap:0;aspect-ratio:1;flex-shrink:0;' +
        'border:.35rem solid #8b6914;outline:.2rem solid #000;' +
        'image-rendering:pixelated}' +

      '.ch-cell{position:relative;display:flex;align-items:center;' +
        'justify-content:center;cursor:default;user-select:none;aspect-ratio:1;overflow:hidden;' +
        'box-sizing:border-box;image-rendering:pixelated}' +
      '.ch-cell.ch-dark{background:#6b5a42}' +
      '.ch-cell.ch-light{background:#d4c49a}' +

      '.ch-cell.ch-clickable{cursor:pointer}' +

      '.ch-cell.ch-last-from,.ch-cell.ch-last-to{background:rgba(255,215,0,.18)}' +

      '.ch-cell.ch-in-check{background:rgba(255,60,60,.35)}' +

      '.ch-piece-img{width:78%;height:78%;max-width:78%;max-height:78%;aspect-ratio:1;flex-shrink:0;' +
        'image-rendering:pixelated;pointer-events:none;object-fit:contain;' +
        'transition:transform .12s ease,filter .12s ease}' +

      '.ch-piece-img.ch-selected{transform:scale(1.15);' +
        'outline:.15rem solid #ffd700;outline-offset:.05rem}' +

      '.ch-valid-move::after{content:"";position:absolute;inset:0;margin:auto;' +
        'width:24%;height:24%;max-width:24%;max-height:24%;aspect-ratio:1;' +
        'background:rgba(255,215,0,.75);pointer-events:none;z-index:2;' +
        'transform:rotate(45deg);image-rendering:pixelated}' +

      '.ch-valid-capture::after{content:"";position:absolute;inset:0;margin:auto;' +
        'width:55%;height:55%;max-width:55%;max-height:55%;aspect-ratio:1;' +
        'border:.2rem solid rgba(255,70,70,.85);' +
        'pointer-events:none;z-index:2;image-rendering:pixelated}' +

      '.ch-timer-setting{display:flex;align-items:center;gap:.4rem;font-size:.45rem}' +
      '.ch-timer-setting.hidden{display:none}' +
      '.ch-timer-setting label{color:#888}' +
      ".ch-timer-setting select{font-family:'Press Start 2P',monospace;" +
        'font-size:.4rem;background:#1a1a1a;color:#ddd;border:.1rem solid #333;' +
        'border-radius:.2rem;padding:.2rem .3rem;cursor:pointer}' +
      '.ch-config-overlay{position:absolute;inset:0;background:rgba(0,0,0,.85);z-index:10;' +
        'display:flex;align-items:center;justify-content:center;padding:1rem;backdrop-filter:blur(4px) grayscale(0.3)}' +
      '.ch-config-overlay.ch-hidden{display:none}' +
      '.ch-config-layout{display:flex;gap:1rem;max-width:36rem;width:100%;max-height:90vh}' +
      '.ch-config-panel{background:#161b22;border:.2rem solid #30363d;border-radius:.5rem;' +
        'padding:1rem;max-width:22rem;width:100%;flex-shrink:0}' +
      '.ch-config-chat{display:flex;flex-direction:column;min-width:10rem;flex:1;max-width:14rem;' +
        'background:#161b22;border:.2rem solid #30363d;border-radius:.5rem;overflow:hidden}' +
      '.ch-config-chat-header{font-size:.45rem;color:#c9b896;padding:.4rem;border-bottom:.1rem solid #30363d}' +
      '.ch-config-chat-messages{flex:1;overflow-y:auto;padding:.4rem;font-size:.35rem;min-height:6rem}' +
      '.ch-config-chat-input{font-family:inherit;font-size:.35rem;padding:.3rem;border:none;border-top:.1rem solid #30363d;background:#0d1117;color:#ddd}' +
      '.ch-chat-msg{font-size:.35rem;margin-bottom:.25rem;word-break:break-word}' +
      '.ch-chat-msg.you .ch-chat-nick{color:#4ade80}' +
      '.ch-chat-nick{color:#8b949e}' +
      '.ch-config-title{font-size:.6rem;color:#c9b896;margin-bottom:.75rem;text-align:center}' +
      '.ch-config-opponent{margin-bottom:.75rem;padding:.5rem;background:#0d1117;border-radius:.25rem}' +
      '.ch-config-opponent-label{font-size:.35rem;color:#8b949e;margin-bottom:.2rem}' +
      '.ch-config-opponent-name{font-size:.5rem;color:#ddd}' +
      '.ch-config-opponent-chips{font-size:.4rem;color:#c9b896;margin-top:.2rem}' +
      '.ch-config-timer{margin-bottom:.75rem;display:flex;align-items:center;gap:.5rem}' +
      '.ch-config-timer label{font-size:.4rem;color:#888}' +
      ".ch-config-timer select{font-family:'Press Start 2P',monospace;font-size:.4rem;" +
        'background:#1a1a1a;color:#ddd;border:.1rem solid #333;border-radius:.2rem;padding:.2rem}' +
      '.ch-config-wagers{margin-bottom:.75rem}' +
      '.ch-config-wager-row{margin-bottom:.5rem;display:flex;flex-direction:column;gap:.25rem}' +
      '.ch-config-wager-row label{font-size:.4rem;color:#888}' +
      '.ch-config-wager-row input[type=range]{width:100%}' +
      ".ch-lock-btn{font-family:'Press Start 2P',monospace;font-size:.35rem;padding:.25rem .5rem;" +
        'background:#238636;color:#fff;border:none;border-radius:.2rem;cursor:pointer;align-self:flex-start}' +
      '.ch-lock-btn.ch-locked{background:#1b4332;border:.125rem solid #40916c;color:#8b949e}' +
      '.ch-opponent-wager label{color:#666}' +
      '.ch-opponent-locked{font-size:.35rem;color:#4ade80;margin-left:.25rem}' +
      '.ch-opponent-locked.ch-hidden{display:none}' +
      '.ch-opponent-slider-display{height:.5rem;background:#1a1a1a;border-radius:.1rem;overflow:hidden}' +
      '.ch-player-chips{color:#c9b896;font-size:.4rem;margin-left:.25rem}' +
      '.ch-config-wager-msg{font-size:.35rem;color:#ff6b6b;margin-top:.25rem;display:none}' +
      '.ch-config-wager-msg.ch-show{display:block}' +
      '.ch-config-buttons{display:flex;gap:.5rem;margin-top:.5rem}' +
      '.ch-config-buttons button{flex:1}' +
      '.ch-gameover-buttons{display:flex;gap:.5rem;margin-top:1rem}' +
      '.ch-gameover-buttons button{flex:1}' +
      '.ch-gameover-overlay{position:absolute;inset:0;background:rgba(0,0,0,.9);z-index:15;' +
        'display:flex;align-items:center;justify-content:center;padding:1rem;backdrop-filter:blur(4px) grayscale(0.3)}' +
      '.ch-gameover-overlay.ch-hidden{display:none}' +
      '.ch-gameover-panel{background:#161b22;border:.2rem solid #30363d;border-radius:.5rem;padding:1.5rem;text-align:center;min-width:18rem}' +
      '.ch-gameover-title{font-size:.6rem;color:#c9b896;margin-bottom:1rem}' +
      '.ch-gameover-winner{font-size:.5rem;color:#4ade80;margin-bottom:.5rem}' +
      '.ch-gameover-amount{font-size:.45rem;color:#c9b896;margin-bottom:.5rem}' +
      '.ch-gameover-loser{font-size:.4rem;color:#f87171;margin-bottom:1rem}' +

      '.ch-turn-timer{font-size:.8rem;color:#ffd700;text-align:center;' +
        'padding:.2rem .5rem;letter-spacing:.05rem}' +
      '.ch-turn-timer.hidden{display:none}' +
      '.ch-turn-timer.ch-timer-urgent{color:#ff4444;animation:chTimerBlink .5s ease-in-out infinite}' +
      '@keyframes chTimerBlink{0%,100%{opacity:1}50%{opacity:.4}}';

    document.head.appendChild(s);
  }

  /* ── DOM setup ── */

  function buildScreen() {
    screenEl = document.getElementById('ch-screen');
    if (screenEl) {
      boardEl = document.getElementById('ch-board');
      statusEl = document.getElementById('ch-status');
      roomLabelEl = document.getElementById('ch-room-label');
      playersAreaEl = document.getElementById('ch-players-area');
      return;
    }

    screenEl = document.createElement('div');
    screenEl.id = 'ch-screen';
    screenEl.className = 'hidden';
    screenEl.innerHTML =
      '<div class="ch-room-bar">' +
        '<button type="button" id="ch-back-btn" class="btn-back-inline" title="Back to game selection"><img src="icon-home.png" alt="" class="btn-back-icon"> Lobby</button>' +
        '<span id="ch-room-label"></span>' +
        '<span class="ch-chips-display" id="ch-chips-display">$0</span>' +
        '<button id="ch-start-btn" class="btn-start hidden">Start Game</button>' +
        '<button id="ch-rematch-btn" class="btn-restart hidden">Rematch</button>' +
        '<div class="ch-room-bar-spacer"></div>' +
        '<button type="button" id="ch-radio-btn" class="lobby-header-btn" title="Radio" aria-label="Radio"><img src="icon-radio.png" alt="" class="lobby-header-icon"></button>' +
        '<button type="button" id="ch-themes-btn" class="lobby-header-btn" title="Themes" aria-label="Themes"><img src="icon-themes.png" alt="" class="lobby-header-icon"></button>' +
        '<button type="button" id="ch-settings-btn" class="lobby-header-btn" title="Settings" aria-label="Settings"><img src="icon-settings.png" alt="" class="lobby-header-icon"></button>' +
      '</div>' +
      '<div class="ch-config-overlay" id="ch-config-overlay">' +
        '<div class="ch-config-layout">' +
        '<div class="ch-config-panel">' +
          '<h2 class="ch-config-title">Configure Game</h2>' +
          '<div class="ch-config-opponent" id="ch-config-opponent">' +
            '<div class="ch-config-opponent-label">Opponent</div>' +
            '<div class="ch-config-opponent-name" id="ch-config-opponent-name">Waiting...</div>' +
            '<div class="ch-config-opponent-chips" id="ch-config-opponent-chips"></div>' +
          '</div>' +
          '<div class="ch-config-timer">' +
            '<label for="ch-timer-select">Turn timer</label>' +
            '<select id="ch-timer-select">' +
              '<option value="0">No timer</option>' +
              '<option value="30">30 sec</option>' +
              '<option value="60">60 sec</option>' +
              '<option value="120">2 min</option>' +
              '<option value="300">5 min</option>' +
            '</select>' +
          '</div>' +
          '<div class="ch-config-wagers">' +
            '<div class="ch-config-wager-row">' +
              '<label>Your wager: $<span id="ch-wager-value">0</span></label>' +
              '<input type="range" id="ch-wager-slider" min="0" max="100" value="0" step="5">' +
              '<button type="button" id="ch-wager-lock-btn" class="ch-lock-btn">Lock In</button>' +
            '</div>' +
            '<div class="ch-config-wager-row ch-opponent-wager">' +
              '<label>Opponent wager: $<span id="ch-opponent-wager-value">0</span> <span id="ch-opponent-locked" class="ch-opponent-locked ch-hidden">Locked</span></label>' +
              '<div class="ch-opponent-slider-display" id="ch-opponent-slider-display"></div>' +
            '</div>' +
            '<div class="ch-config-wager-msg" id="ch-wager-mismatch-msg">Wagers must match</div>' +
          '</div>' +
          '<div class="ch-config-buttons">' +
            '<button id="ch-config-back-btn" class="btn-back">Back to Lobby</button>' +
            '<button id="ch-config-start-btn" class="btn-start">Start Game</button>' +
          '</div>' +
        '</div>' +
        '<div class="ch-config-chat">' +
          '<div class="ch-config-chat-header">Chat</div>' +
          '<div class="ch-config-chat-messages" id="ch-config-chat-messages"></div>' +
          '<input type="text" id="ch-config-chat-input" class="ch-config-chat-input" placeholder="Send message..." maxlength="100">' +
        '</div>' +
        '</div>' +
      '</div>' +
      '<div class="ch-gameover-overlay ch-hidden" id="ch-gameover-overlay">' +
        '<div class="ch-gameover-panel">' +
          '<h2 class="ch-gameover-title" id="ch-gameover-title">Game Over</h2>' +
          '<div class="ch-gameover-winner" id="ch-gameover-winner"></div>' +
          '<div class="ch-gameover-amount" id="ch-gameover-amount"></div>' +
          '<div class="ch-gameover-loser" id="ch-gameover-loser"></div>' +
          '<div class="ch-gameover-buttons">' +
            '<button id="ch-gameover-back-btn" class="btn-back">Back to Lobby</button>' +
            '<button id="ch-gameover-rematch-btn" class="btn-start">Rematch</button>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div id="ch-turn-timer" class="ch-turn-timer hidden"></div>' +
      '<div id="ch-status"></div>' +
      '<div id="ch-wager-display" class="ch-wager-display ch-hidden"></div>' +
      '<div id="ch-players-area"></div>' +
      '<div class="ch-board-wrap"><div id="ch-board"></div></div>' +
      '<div class="now-playing-radio hidden" id="ch-now-playing-radio">' +
        '<span class="now-playing-label" id="ch-now-playing-radio-label"></span>' +
        '<button type="button" class="now-playing-stop" id="ch-radio-stop" title="Stop radio">&#x25A0;</button>' +
      '</div>';

    document.body.appendChild(screenEl);

    var backBtn = document.getElementById('ch-back-btn');
    if (backBtn) backBtn.addEventListener('click', function () { send({ type: 'backToLobby' }); });

    var startBtn = document.getElementById('ch-start-btn');
    if (startBtn) startBtn.addEventListener('click', function () {
      var sel = document.getElementById('ch-timer-select');
      var timer = sel ? parseInt(sel.value, 10) : 0;
      send({ type: 'startGame', gameType: 'chess', timerSeconds: timer });
    });

    var rematchBtn = document.getElementById('ch-rematch-btn');
    if (rematchBtn) rematchBtn.addEventListener('click', function () {
      var overlay = document.getElementById('ch-gameover-overlay');
      if (overlay) overlay.classList.add('ch-hidden');
      send({ type: 'chRematch' });
    });

    var chWagerSlider = document.getElementById('ch-wager-slider');
    var chWagerValue = document.getElementById('ch-wager-value');
    var chWagerLockBtn = document.getElementById('ch-wager-lock-btn');
    if (chWagerSlider) chWagerSlider.addEventListener('input', function () {
      var val = parseInt(chWagerSlider.value, 10);
      if (chWagerValue) chWagerValue.textContent = val;
      if (!chWagerLockBtn || !chWagerLockBtn.classList.contains('ch-locked')) {
        send({ type: 'chWagerProposal', amount: val });
      }
    });
    if (chWagerLockBtn) chWagerLockBtn.addEventListener('click', function () {
      if (chWagerLockBtn.classList.contains('ch-locked')) {
        send({ type: 'chWagerUnlock' });
        return;
      }
      var val = parseInt(chWagerSlider ? chWagerSlider.value : 0, 10);
      chWagerLockBtn.classList.add('ch-locked');
      chWagerLockBtn.textContent = 'Unlock';
      if (chWagerSlider) chWagerSlider.disabled = true;
      send({ type: 'chWagerLock', amount: val });
    });
    var chTimerSelect = document.getElementById('ch-timer-select');
    if (chTimerSelect) chTimerSelect.addEventListener('change', function () {
      var val = parseInt(chTimerSelect.value, 10);
      send({ type: 'chTimerChange', timerSeconds: val });
    });
    var chConfigBackBtn = document.getElementById('ch-config-back-btn');
    if (chConfigBackBtn) chConfigBackBtn.addEventListener('click', function () { send({ type: 'backToLobby' }); });
    var chConfigChatInput = document.getElementById('ch-config-chat-input');
    if (chConfigChatInput) chConfigChatInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        var text = (chConfigChatInput.value || '').trim();
        if (text && chWs && chWs.readyState === WebSocket.OPEN) {
          chWs.send(JSON.stringify({ type: 'chat', text: text }));
          chConfigChatInput.value = '';
        }
      }
    });
    var chGameoverBackBtn = document.getElementById('ch-gameover-back-btn');
    if (chGameoverBackBtn) chGameoverBackBtn.addEventListener('click', function () { send({ type: 'backToLobby' }); });
    var chGameoverRematchBtn = document.getElementById('ch-gameover-rematch-btn');
    if (chGameoverRematchBtn) chGameoverRematchBtn.addEventListener('click', function () {
      var overlay = document.getElementById('ch-gameover-overlay');
      if (overlay) overlay.classList.add('ch-hidden');
      send({ type: 'chRematch' });
    });
    var chConfigStartBtn = document.getElementById('ch-config-start-btn');
    if (chConfigStartBtn) chConfigStartBtn.addEventListener('click', function () {
      var sel = document.getElementById('ch-timer-select');
      var timer = sel ? parseInt(sel.value, 10) : 0;
      send({ type: 'startGame', gameType: 'chess', timerSeconds: timer });
    });
    var chSettingsBtn = document.getElementById('ch-settings-btn');
    if (chSettingsBtn) chSettingsBtn.addEventListener('click', function () {
      var overlay = document.getElementById('settings-overlay');
      if (overlay) overlay.classList.remove('hidden');
    });
    var chRadioBtn = document.getElementById('ch-radio-btn');
    if (chRadioBtn) chRadioBtn.addEventListener('click', function () {
      var overlay = document.getElementById('radio-overlay');
      var searchInput = document.getElementById('radio-search');
      if (overlay) overlay.classList.remove('hidden');
      if (searchInput) searchInput.focus();
    });
    var chThemesBtn = document.getElementById('ch-themes-btn');
    if (chThemesBtn) chThemesBtn.addEventListener('click', function () {
      var overlay = document.getElementById('themes-overlay');
      if (overlay) overlay.classList.remove('hidden');
    });

    var chRadioStop = document.getElementById('ch-radio-stop');
    if (chRadioStop) chRadioStop.addEventListener('click', function () {
      if (chWs && chWs.readyState === WebSocket.OPEN) {
        chWs.send(JSON.stringify({ type: 'stopRadio' }));
      }
    });

    boardEl = document.getElementById('ch-board');
    statusEl = document.getElementById('ch-status');
    roomLabelEl = document.getElementById('ch-room-label');
    playersAreaEl = document.getElementById('ch-players-area');
  }

  /* ── Rendering ── */

  function isDark(r, c) { return (r + c) % 2 === 1; }

  function renderBoard() {
    if (!boardEl || !chBoard) return;
    boardEl.innerHTML = '';

    var flipped = chMyColor === 'black';
    var myTurn = chGameState === 'playing' && chTurn === chMyColor;

    for (var dr = 0; dr < 8; dr++) {
      for (var dc = 0; dc < 8; dc++) {
        var r = flipped ? 7 - dr : dr;
        var c = flipped ? 7 - dc : dc;

        var cell = document.createElement('div');
        cell.className = 'ch-cell ' + (isDark(r, c) ? 'ch-dark' : 'ch-light');

        if (chLastMove) {
          if (chLastMove.from && chLastMove.from.row === r && chLastMove.from.col === c) cell.classList.add('ch-last-from');
          if (chLastMove.to && chLastMove.to.row === r && chLastMove.to.col === c) cell.classList.add('ch-last-to');
        }

        var piece = chBoard[r][c];

        if (chInCheck && piece && piece.type === 'king' && piece.color === chTurn) {
          cell.classList.add('ch-in-check');
        }

        var vm = chValidMoves.find(function (m) { return m.row === r && m.col === c; });

        if (piece) {
          var img = document.createElement('img');
          img.className = 'ch-piece-img';
          img.src = pieceImg(piece);
          img.alt = piece.color + ' ' + piece.type;
          img.draggable = false;
          if (chSelected && chSelected.row === r && chSelected.col === c) {
            img.classList.add('ch-selected');
          }
          cell.appendChild(img);
        }

        if (vm) {
          cell.classList.add(vm.captured ? 'ch-valid-capture' : 'ch-valid-move');
          cell.classList.add('ch-clickable');
        } else if (myTurn && piece && piece.color === chMyColor) {
          cell.classList.add('ch-clickable');
        }

        (function (row, col) {
          cell.addEventListener('click', function () { onCellClick(row, col); });
        })(r, c);

        boardEl.appendChild(cell);
      }
    }
  }

  function renderPlayers() {
    if (!playersAreaEl) return;
    playersAreaEl.innerHTML = '';

    for (var i = 0; i < chPlayers.length; i++) {
      var p = chPlayers[i];
      var tag = document.createElement('div');
      tag.className = 'ch-player-tag';
      if (chGameState === 'playing' && p.color === chTurn) tag.classList.add('ch-turn');
      if (p.id === chMyId) tag.classList.add('ch-is-me');

      var sw = document.createElement('div');
      sw.className = 'ch-player-swatch ch-color-' + (p.color || 'white');
      tag.appendChild(sw);

      var nm = document.createElement('span');
      nm.className = 'ch-player-name';
      nm.textContent = (p.nickname || p.id) + (p.id === chMyId ? ' (you)' : '');
      tag.appendChild(nm);
      if (chGameState === 'playing') {
        var chips = chWagerChips[p.id] ?? (chPlayers.find(function (x) { return x.id === p.id; })?.chips ?? 0);
        var chipsSpan = document.createElement('span');
        chipsSpan.className = 'ch-player-chips';
        chipsSpan.textContent = ' $' + chips;
        tag.appendChild(chipsSpan);
      }

      if (p.color) {
        var cap = document.createElement('span');
        cap.className = 'ch-captures';
        cap.textContent = ' ' + (p.color === 'white' ? chCapturesWhite : chCapturesBlack) + ' captured';
        tag.appendChild(cap);
      }

      playersAreaEl.appendChild(tag);
    }
  }

  function renderAll() {
    renderBoard();
    renderPlayers();
    updateChChipsDisplay();
    updateButtons();
  }

  function updateChChipsDisplay() {
    var el = document.getElementById('ch-chips-display');
    if (!el) return;
    var chips = chWagerChips[chMyId] ?? (chPlayers.find(function (p) { return p.id === chMyId; })?.chips ?? 0);
    el.textContent = '$' + chips;
  }

  function updateButtons() {
    var startBtn = document.getElementById('ch-start-btn');
    var rematchBtn = document.getElementById('ch-rematch-btn');
    var overlay = document.getElementById('ch-config-overlay');
    if (startBtn) startBtn.classList.toggle('hidden', chGameState !== 'waiting');
    if (rematchBtn) rematchBtn.classList.toggle('hidden', chGameState !== 'over');
    if (overlay) {
      overlay.classList.toggle('ch-hidden', chGameState !== 'waiting');
    }
    updateChWagerSlider();
    updateChConfigPanel();
  }

  function updateChWagerSlider() {
    var slider = document.getElementById('ch-wager-slider');
    var valEl = document.getElementById('ch-wager-value');
    var lockBtn = document.getElementById('ch-wager-lock-btn');
    var oppValEl = document.getElementById('ch-opponent-wager-value');
    var oppDisplay = document.getElementById('ch-opponent-slider-display');
    if (!slider || !valEl) return;
    var myChips = chWagerChips[chMyId] ?? (chPlayers.find(function (p) { return p.id === chMyId; })?.chips ?? 0);
    var otherIds = Object.keys(chWagerChips).filter(function (id) { return id !== chMyId; });
    var oppChips = otherIds.length ? Math.min.apply(null, otherIds.map(function (id) { return chWagerChips[id] || 0; })) : 0;
    var maxWager = Math.min(myChips, oppChips);
    slider.max = Math.max(1, maxWager);
    slider.min = 0;
    var locked = chWagerLocked[chMyId];
    if (locked !== undefined) {
      if (lockBtn) { lockBtn.classList.add('ch-locked'); lockBtn.textContent = 'Unlock'; }
      if (slider) slider.disabled = true;
      valEl.textContent = locked;
    } else {
      var prop = chWagerProposals[chMyId] || 0;
      var capped = Math.min(prop, maxWager);
      slider.value = capped;
      valEl.textContent = capped;
      if (lockBtn) { lockBtn.classList.remove('ch-locked'); lockBtn.textContent = 'Lock In'; }
      if (slider) slider.disabled = false;
    }
    var oppProp = otherIds.length ? (chWagerProposals[otherIds[0]] ?? 0) : 0;
    var oppLocked = otherIds.length ? chWagerLocked[otherIds[0]] : undefined;
    var oppWager = oppLocked !== undefined ? oppLocked : oppProp;
    if (oppValEl) oppValEl.textContent = oppWager;
    var oppLockedEl = document.getElementById('ch-opponent-locked');
    if (oppLockedEl) oppLockedEl.classList.toggle('ch-hidden', oppLocked === undefined);
    if (oppDisplay) {
      oppDisplay.style.background = 'linear-gradient(to right, #238636 0%, #238636 ' + (maxWager > 0 ? (oppWager / maxWager * 100) : 0) + '%, #1a1a1a ' + (maxWager > 0 ? (oppWager / maxWager * 100) : 0) + '%)';
    }
    var mismatchMsg = document.getElementById('ch-wager-mismatch-msg');
    var configStartBtn = document.getElementById('ch-config-start-btn');
    var myLocked = chWagerLocked[chMyId];
    var bothLocked = myLocked !== undefined && (otherIds.length ? chWagerLocked[otherIds[0]] !== undefined : false);
    var match = bothLocked && otherIds.length && myLocked === chWagerLocked[otherIds[0]];
    if (mismatchMsg) mismatchMsg.classList.toggle('ch-show', bothLocked && !match);
    if (mismatchMsg && !bothLocked) mismatchMsg.classList.remove('ch-show');
    if (configStartBtn) configStartBtn.disabled = !bothLocked || !match;
  }

  function updateChConfigPanel() {
    var oppName = document.getElementById('ch-config-opponent-name');
    var oppChipsEl = document.getElementById('ch-config-opponent-chips');
    var other = chPlayers.find(function (p) { return p.id !== chMyId; });
    if (oppName) oppName.textContent = other ? (chWagerNicknames[other.id] || other.nickname || 'Opponent') : 'Waiting...';
    if (oppChipsEl) oppChipsEl.textContent = other ? '$' + (chWagerChips[other.id] ?? other.chips ?? 0) : '';
  }

  /* ── Timer ── */

  function startChTimer(deadline) {
    stopChTimer();
    chTurnDeadline = deadline;
    chTimeLowAlertPlayed = false;
    if (!deadline) return;
    updateChTimerDisplay();
    chTimerInterval = setInterval(updateChTimerDisplay, 200);
  }

  function stopChTimer() {
    if (chTimerInterval) { clearInterval(chTimerInterval); chTimerInterval = null; }
    chTurnDeadline = 0;
    var el = document.getElementById('ch-turn-timer');
    if (el) el.classList.add('hidden');
  }

  function updateChTimerDisplay() {
    var el = document.getElementById('ch-turn-timer');
    if (!el || !chTurnDeadline) return;
    var remaining = Math.max(0, Math.ceil((chTurnDeadline - Date.now()) / 1000));
    el.textContent = remaining + 's';
    el.classList.remove('hidden');
    el.classList.toggle('ch-timer-urgent', remaining <= 5);
    if (remaining <= 0) stopChTimer();
  }

  /* ── Click handling ── */

  function onCellClick(row, col) {
    if (chGameState !== 'playing' || chTurn !== chMyColor) return;

    var vm = chValidMoves.find(function (m) { return m.row === row && m.col === col; });
    if (vm && chSelected) {
      send({
        type: 'chMove',
        from: { row: chSelected.row, col: chSelected.col },
        to: { row: row, col: col }
      });
      chSelected = null;
      chValidMoves = [];
      renderBoard();
      return;
    }

    var piece = chBoard[row][col];
    if (piece && piece.color === chMyColor) {
      chSelected = { row: row, col: col };
      chValidMoves = getValidMoves(chBoard, row, col, chMyColor);
      if (typeof playSelectPiece === 'function') playSelectPiece();
      renderBoard();
      return;
    }

    chSelected = null;
    chValidMoves = [];
    renderBoard();
  }

  /* ── WebSocket message handling ── */

  function handleMessage(msg) {
    switch (msg.type) {
      case 'chGameStarted': {
        chGameState = 'playing';
        chCapturesWhite = 0;
        chCapturesBlack = 0;
        var goOv = document.getElementById('ch-gameover-overlay');
        if (goOv) goOv.classList.add('ch-hidden');
        chBoard = msg.board || emptyBoard();
        chTurn = msg.turn || 'white';
        chWinner = null;
        chSelected = null;
        chValidMoves = [];
        chCastling = msg.castling || null;
        chEnPassant = msg.enPassant || null;
        chLastMove = null;
        chInCheck = false;
        chTimerSeconds = msg.timerSeconds || 0;
        chWagerAmount = msg.wager || 0;
        if (msg.playersChips) chWagerChips = msg.playersChips;
        var selSync = document.getElementById('ch-timer-select');
        if (selSync) selSync.value = String(chTimerSeconds);
        if (msg.players) {
          chPlayers = msg.players;
          var me = chPlayers.find(function (p) { return p.id === chMyId; });
          if (me) chMyColor = me.color;
        }
        if (chTurn === chMyColor && typeof playYourTurn === 'function') playYourTurn();
        setStatus(chTurn === chMyColor ? 'Your turn!' : 'Waiting for opponent...');
        if (msg.timerMs > 0) startChTimer(Date.now() + msg.timerMs);
        else stopChTimer();
        renderAll();
        break;
      }

      case 'chYourColor':
        chMyColor = msg.color;
        renderAll();
        break;

      case 'chWagerState':
        chWagerProposals = msg.proposals || {};
        chWagerReady = msg.ready || {};
        chWagerLocked = msg.locked || {};
        chWagerChips = msg.chips || {};
        chWagerNicknames = msg.nicknames || {};
        updateChWagerSlider();
        updateChConfigPanel();
        break;

      case 'chWagerMismatch':
        if (typeof showToast === 'function') showToast(msg.message || 'Wagers must match');
        break;

      case 'chTimerChanged':
        var sel = document.getElementById('ch-timer-select');
        if (sel && msg.timerSeconds !== undefined) sel.value = String(msg.timerSeconds);
        break;

      case 'chPlayersUpdated':
        if (msg.players) {
          var prevIds = {};
          chPlayers.forEach(function (p) { prevIds[p.id] = true; });
          chPlayers = msg.players;
          chWagerChips = {};
          chPlayers.forEach(function (p) {
            chWagerChips[p.id] = p.chips || 0;
            chWagerNicknames[p.id] = p.nickname || 'Player';
            if (!prevIds[p.id] && p.id !== chMyId) {
              var chatEl = document.getElementById('ch-config-chat-messages');
              if (chatEl) {
                var sysMsg = document.createElement('div');
                sysMsg.className = 'ch-chat-msg system';
                sysMsg.style.cssText = 'color:#8b949e;font-style:italic';
                sysMsg.textContent = (p.nickname || 'Player') + ' joined Chess';
                chatEl.appendChild(sysMsg);
                chatEl.scrollTop = chatEl.scrollHeight;
              }
            }
          });
        }
        renderAll();
        break;

      case 'chBoardUpdate':
        chBoard = msg.board;
        chTurn = msg.turn;
        chSelected = null;
        chValidMoves = [];
        chCastling = msg.castling || null;
        chEnPassant = msg.enPassant || null;
        chLastMove = msg.lastMove || null;
        chInCheck = msg.inCheck || false;

        if (msg.lastMove && msg.lastMove.captured) {
          if (msg.lastMove.capturedColor === 'white') chCapturesBlack++;
          else chCapturesWhite++;
        }

        if (msg.lastMove && msg.lastMove.captured) {
          playChessSound(CAPTURE_SFX);
        } else if (msg.lastMove) {
          playChessPiecePlaceSfx();
        }

        if (chTurn === chMyColor && prevChTurn !== chMyColor && typeof playYourTurn === 'function') playYourTurn();
        if (chInCheck) {
          playCheckAlert();
          setStatus(chTurn === chMyColor ? 'Check! Your turn!' : 'Check!');
        } else if (chTurn === chMyColor) {
          setStatus('Your turn!');
        } else {
          setStatus('Waiting for opponent...');
        }

        if (msg.timerMs > 0) startChTimer(Date.now() + msg.timerMs);
        else stopChTimer();
        renderAll();
        break;
      }

      case 'chGameOver': {
        chGameState = 'over';
        chWinner = msg.winner;
        chSelected = null;
        chValidMoves = [];
        stopChTimer();
        chWagerLocked = {};
        if (msg.players) msg.players.forEach(function (p) { chWagerChips[p.id] = p.chips; });
        chWagerReady = {};
        if (chWinner === chMyColor && typeof playWinCheckersChess === 'function') playWinCheckersChess();
        else if (chWinner && chWinner !== chMyColor && typeof playLoseCheckersChess === 'function') playLoseCheckersChess();
        var reasonMap = {
          checkmate: 'checkmate',
          stalemate: 'stalemate',
          timeout: 'time ran out',
          disconnect: 'opponent disconnected'
        };
        var reason = reasonMap[msg.reason] || msg.reason;
        if (msg.reason === 'stalemate') {
          setStatus('Draw by ' + reason + '!');
        } else {
          setStatus(
            chWinner === chMyColor
              ? 'You win! (' + reason + ')'
              : (chWinner || 'Opponent') + ' wins! (' + reason + ')'
          );
        }
        var wager = msg.wager || 0;
        var goOverlay = document.getElementById('ch-gameover-overlay');
        var goTitle = document.getElementById('ch-gameover-title');
        var goWinner = document.getElementById('ch-gameover-winner');
        var goAmount = document.getElementById('ch-gameover-amount');
        var goLoser = document.getElementById('ch-gameover-loser');
        if (goOverlay) {
          goOverlay.classList.remove('ch-hidden');
          var winnerName = chWinner === chMyColor ? 'You' : (msg.winnerNickname || chWinner || 'Winner');
          var loserName = chWinner === chMyColor ? (msg.loserNickname || 'Opponent') : 'You';
          if (goTitle) goTitle.textContent = msg.reason === 'stalemate' ? 'Draw' : 'Game Over';
          if (goWinner) goWinner.textContent = msg.reason === 'stalemate' ? 'Stalemate - Draw!' : (winnerName + ' won!');
          if (goAmount) goAmount.textContent = (msg.reason !== 'stalemate' && wager > 0) ? winnerName + ' won $' + wager : '';
          if (goLoser) goLoser.textContent = (msg.reason !== 'stalemate' && wager > 0) ? loserName + ' lost $' + wager : '';
        }
        if ((chWagerChips[chMyId] || 0) === 0 && typeof window !== 'undefined' && window.scheduleBrokeKickToLobby) {
          window.scheduleBrokeKickToLobby();
        }
        renderAll();
        break;
      }

      case 'chWaiting':
        chGameState = 'waiting';
        chCapturesWhite = 0;
        chCapturesBlack = 0;
        stopChTimer();
        setStatus('Waiting for opponent...');
        var goOv = document.getElementById('ch-gameover-overlay');
        if (goOv) goOv.classList.add('ch-hidden');
        renderAll();
        break;

      case 'chPlayerLeft':
        chGameState = 'over';
        stopChTimer();
        setStatus('Opponent disconnected');
        renderAll();
        break;
    }
  }

  /* ── Lifecycle ── */

  function init(ws, myId, players, roomKey) {
    chWs = ws;
    chMyId = myId;
    chPlayers = players || [];
    chWagerChips = {};
    chWagerNicknames = {};
    chPlayers.forEach(function (p) {
      chWagerChips[p.id] = p.chips || 0;
      chWagerNicknames[p.id] = p.nickname || 'Player';
    });
    chWagerProposals = {};
    chWagerReady = {};
    chWagerLocked = {};
    chRoomKey = roomKey || '';
    chGameState = 'waiting';
    chCapturesWhite = 0;
    chCapturesBlack = 0;
    chBoard = emptyBoard();
    chTurn = null;
    chSelected = null;
    chValidMoves = [];
    chWinner = null;
    chMyColor = null;
    chCastling = null;
    chEnPassant = null;
    chLastMove = null;
    chInCheck = false;
    chTimerSeconds = 0;
    chTurnDeadline = 0;
    stopChTimer();

    injectStyles();
    buildScreen();

    if (roomLabelEl) roomLabelEl.textContent = 'Chess \u2014 ' + chRoomKey;
    setStatus('Waiting for opponent...');
    renderAll();
  }

  function show() {
    injectStyles();
    buildScreen();
    if (screenEl) screenEl.classList.remove('hidden');
  }

  function hide() {
    if (screenEl) screenEl.classList.add('hidden');
  }

  /* ── Exports ── */

  window.chSetWs = function (ws) { chWs = ws; };
  window.chess = { init: init, handleMessage: handleMessage, show: show, hide: hide };
})();
