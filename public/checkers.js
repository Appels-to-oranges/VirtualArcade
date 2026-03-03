(function () {
  'use strict';

  const SPRITE_SHEET = '/checkers/pieces.png';
  const BOARD_BG = '/checkers/boards/board_plain_01.png';
  const CURSOR_IMG = '/checkers/cursor.png';

  /* Sprite positions (percentage-based, with background-size: 400% 100%)
     Sheet is 64x16 — four 16x16 sprites in a row. */
  const SP_WHITE      = '0% 0';
  const SP_WHITE_KING = '33.333% 0';
  const SP_BLACK      = '66.667% 0';
  const SP_BLACK_KING = '100% 0';

  /* ── State ── */

  let ckWs = null;
  let ckMyId = null;
  let ckMyColor = null;
  let ckBoard = null;
  let ckTurn = null;
  let ckSelected = null;
  let ckValidMoves = [];
  let ckGameState = 'waiting';
  let ckPlayers = [];
  let ckWinner = null;
  let ckMustContinue = null;
  let ckRoomKey = '';

  /* ── DOM refs (lazily initialised) ── */

  let screenEl = null;
  let boardEl = null;
  let statusEl = null;
  let roomLabelEl = null;
  let playersAreaEl = null;
  let stylesInjected = false;

  /* ── Helpers ── */

  function isDark(r, c) {
    return (r + c) % 2 === 1;
  }

  function emptyBoard() {
    return Array.from({ length: 8 }, () => Array(8).fill(null));
  }

  function send(obj) {
    if (ckWs && ckWs.readyState === WebSocket.OPEN) {
      ckWs.send(JSON.stringify(obj));
    }
  }

  function spritePos(piece) {
    if (piece.color === 'white') return piece.king ? SP_WHITE_KING : SP_WHITE;
    return piece.king ? SP_BLACK_KING : SP_BLACK;
  }

  function setStatus(text) {
    if (statusEl) statusEl.textContent = text;
  }

  /* ── Move logic (client-side highlights; server is authoritative) ── */

  function getValidMoves(board, row, col, color, mustCapture) {
    const piece = board[row][col];
    if (!piece || piece.color !== color) return [];

    const dirs = piece.king
      ? [[-1, -1], [-1, 1], [1, -1], [1, 1]]
      : color === 'red' ? [[-1, -1], [-1, 1]] : [[1, -1], [1, 1]];

    const captures = [];
    const moves = [];

    for (const [dr, dc] of dirs) {
      const mr = row + dr, mc = col + dc;
      const jr = row + 2 * dr, jc = col + 2 * dc;

      if (jr >= 0 && jr < 8 && jc >= 0 && jc < 8 &&
          board[mr][mc] && board[mr][mc].color !== color && !board[jr][jc]) {
        captures.push({ row: jr, col: jc, captured: { row: mr, col: mc } });
      }

      if (!mustCapture && mr >= 0 && mr < 8 && mc >= 0 && mc < 8 && !board[mr][mc]) {
        moves.push({ row: mr, col: mc });
      }
    }

    return captures.length > 0 ? captures : (mustCapture ? [] : moves);
  }

  function hasAnyCapture(board, color) {
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const piece = board[r][c];
        if (!piece || piece.color !== color) continue;
        const dirs = piece.king
          ? [[-1, -1], [-1, 1], [1, -1], [1, 1]]
          : color === 'red' ? [[-1, -1], [-1, 1]] : [[1, -1], [1, 1]];
        for (const [dr, dc] of dirs) {
          const mr = r + dr, mc = c + dc;
          const jr = r + 2 * dr, jc = c + 2 * dc;
          if (jr >= 0 && jr < 8 && jc >= 0 && jc < 8 &&
              board[mr][mc] && board[mr][mc].color !== color && !board[jr][jc]) {
            return true;
          }
        }
      }
    }
    return false;
  }

  /* ── Style injection ── */

  function injectStyles() {
    if (stylesInjected) return;
    stylesInjected = true;

    const style = document.createElement('style');
    style.id = 'ck-styles';
    style.textContent =
      '#ck-screen{position:fixed;inset:0;background:#0a0a0a;z-index:1;' +
        'display:flex;flex-direction:column;align-items:center;' +
        "font-family:'Press Start 2P',monospace;color:#ddd;overflow:hidden}" +

      '#ck-screen .ck-room-bar{width:100%;display:flex;align-items:center;' +
        'justify-content:center;flex-wrap:wrap;gap:.75rem;padding:.4rem .75rem;' +
        'background:#111;border-bottom:.2rem solid #1a1a1a;flex-shrink:0}' +

      '#ck-room-label{font-size:.6rem;color:#666;letter-spacing:.0625rem}' +

      '#ck-screen .btn-start,#ck-screen .btn-restart{' +
        "font-family:'Press Start 2P',monospace;" +
        'font-size:.45rem;padding:.35rem .75rem;border:none;border-radius:.25rem;' +
        'cursor:pointer;text-transform:uppercase;letter-spacing:.05rem}' +
      '#ck-screen .btn-start{background:#238636;color:#fff}' +
      '#ck-screen .btn-start:hover{background:#2ea043}' +
      '#ck-screen .btn-restart{background:#1b4332;color:#ddd;border:.125rem solid #40916c}' +
      '#ck-screen .btn-restart:hover{background:#2d6a4f}' +

      '#ck-status{font-size:.65rem;color:#c9b896;text-transform:uppercase;' +
        'letter-spacing:.1rem;text-align:center;padding:.4rem .5rem;flex-shrink:0}' +

      '#ck-players-area{display:flex;gap:1rem;justify-content:center;' +
        'align-items:center;padding:.25rem .5rem;flex-shrink:0}' +

      '.ck-player-tag{display:flex;align-items:center;gap:.4rem;padding:.3rem .6rem;' +
        'border:.125rem solid #30363d;background:rgba(13,17,23,.6);font-size:.5rem}' +

      '.ck-player-tag.ck-turn{border-color:#ffd700;' +
        'box-shadow:0 0 .5rem rgba(255,215,0,.3)}' +

      '.ck-player-tag.ck-is-me{background:rgba(27,67,50,.3)}' +

      '.ck-player-swatch{width:.7rem;height:.7rem;border:.0625rem solid #555;flex-shrink:0}' +

      '.ck-color-red{background:#444}' +
      '.ck-color-white{background:#eee}' +

      '.ck-player-name{color:#ddd}' +

      '.ck-board-wrap{flex:1;display:flex;align-items:center;justify-content:center;' +
        'min-height:0;padding:.5rem}' +

      '#ck-board{' +
        '--ck-size:min(calc(100vh - 9rem),calc(100vw - 2rem),42rem);' +
        'display:grid;grid-template-columns:repeat(8,1fr);grid-template-rows:repeat(8,1fr);' +
        'width:var(--ck-size);height:var(--ck-size);' +
        "background-image:url('" + BOARD_BG + "');" +
        'background-size:100% 100%;image-rendering:pixelated;' +
        'border:.3rem solid #8b6914;' +
        'box-shadow:0 .25rem 1rem rgba(0,0,0,.6),0 0 0 .15rem #000}' +

      '.ck-cell{position:relative;display:flex;align-items:center;' +
        'justify-content:center;cursor:default;user-select:none}' +

      ".ck-cell.ck-clickable{cursor:url('" + CURSOR_IMG + "') 8 8,pointer}" +

      '.ck-piece{width:78%;height:78%;' +
        "background-image:url('" + SPRITE_SHEET + "');" +
        'background-size:400% 100%;background-repeat:no-repeat;' +
        'image-rendering:pixelated;pointer-events:none;' +
        'transition:transform .12s ease,filter .12s ease}' +

      '.ck-piece.ck-selected{transform:scale(1.18);' +
        'filter:drop-shadow(0 0 .25rem #ffd700) drop-shadow(0 0 .5rem rgba(255,215,0,.5))}' +

      '.ck-valid-move::after{content:"";position:absolute;width:26%;height:26%;' +
        'background:rgba(255,215,0,.6);border-radius:50%;pointer-events:none;z-index:2;' +
        'animation:ckPulse 1.4s ease-in-out infinite}' +

      '.ck-valid-capture::after{content:"";position:absolute;width:60%;height:60%;' +
        'border:.15rem solid rgba(255,80,80,.8);border-radius:50%;' +
        'pointer-events:none;z-index:2;animation:ckPulse 1.4s ease-in-out infinite}' +

      '@keyframes ckPulse{0%,100%{opacity:.5;transform:scale(1)}' +
        '50%{opacity:1;transform:scale(1.08)}}';

    document.head.appendChild(style);
  }

  /* ── DOM setup ── */

  function buildScreen() {
    screenEl = document.getElementById('ck-screen');
    if (screenEl) {
      boardEl = document.getElementById('ck-board');
      statusEl = document.getElementById('ck-status');
      roomLabelEl = document.getElementById('ck-room-label');
      playersAreaEl = document.getElementById('ck-players-area');
      return;
    }

    screenEl = document.createElement('div');
    screenEl.id = 'ck-screen';
    screenEl.className = 'hidden';
    screenEl.innerHTML =
      '<div class="ck-room-bar"><span id="ck-room-label"></span>' +
        '<button id="ck-start-btn" class="btn-start">Start Game</button>' +
        '<button id="ck-rematch-btn" class="btn-restart hidden">Rematch</button>' +
      '</div>' +
      '<div id="ck-status"></div>' +
      '<div id="ck-players-area"></div>' +
      '<div class="ck-board-wrap"><div id="ck-board"></div></div>';

    document.body.appendChild(screenEl);

    var startBtn = document.getElementById('ck-start-btn');
    if (startBtn) startBtn.addEventListener('click', function () {
      send({ type: 'startGame', gameType: 'checkers' });
    });
    var rematchBtn = document.getElementById('ck-rematch-btn');
    if (rematchBtn) rematchBtn.addEventListener('click', function () {
      send({ type: 'startGame', gameType: 'checkers' });
    });
    boardEl = document.getElementById('ck-board');
    statusEl = document.getElementById('ck-status');
    roomLabelEl = document.getElementById('ck-room-label');
    playersAreaEl = document.getElementById('ck-players-area');
  }

  /* ── Rendering ── */

  function renderBoard() {
    if (!boardEl || !ckBoard) return;
    boardEl.innerHTML = '';

    const flipped = ckMyColor === 'white';
    const myTurn = ckGameState === 'playing' && ckTurn === ckMyColor;

    for (let dr = 0; dr < 8; dr++) {
      for (let dc = 0; dc < 8; dc++) {
        const r = flipped ? 7 - dr : dr;
        const c = flipped ? 7 - dc : dc;

        const cell = document.createElement('div');
        cell.className = 'ck-cell ' + (isDark(r, c) ? 'ck-dark' : 'ck-light');

        const piece = ckBoard[r][c];
        const vm = ckValidMoves.find(function (m) { return m.row === r && m.col === c; });

        if (piece) {
          const pd = document.createElement('div');
          pd.className = 'ck-piece';
          pd.style.backgroundPosition = spritePos(piece);
          if (ckSelected && ckSelected.row === r && ckSelected.col === c) {
            pd.classList.add('ck-selected');
          }
          cell.appendChild(pd);
        }

        if (vm) {
          cell.classList.add(vm.captured ? 'ck-valid-capture' : 'ck-valid-move');
          cell.classList.add('ck-clickable');
        } else if (myTurn && piece && piece.color === ckMyColor &&
                   (!ckMustContinue ||
                    (ckMustContinue.row === r && ckMustContinue.col === c))) {
          cell.classList.add('ck-clickable');
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

    for (var i = 0; i < ckPlayers.length; i++) {
      var p = ckPlayers[i];
      var tag = document.createElement('div');
      tag.className = 'ck-player-tag';
      if (ckGameState === 'playing' && p.color === ckTurn) tag.classList.add('ck-turn');
      if (p.id === ckMyId) tag.classList.add('ck-is-me');

      var sw = document.createElement('div');
      sw.className = 'ck-player-swatch ck-color-' + (p.color || 'red');
      tag.appendChild(sw);

      var nm = document.createElement('span');
      nm.className = 'ck-player-name';
      nm.textContent = (p.nickname || p.id) + (p.id === ckMyId ? ' (you)' : '');
      tag.appendChild(nm);

      playersAreaEl.appendChild(tag);
    }
  }

  function renderAll() {
    renderBoard();
    renderPlayers();
    updateButtons();
  }

  function updateButtons() {
    var startBtn = document.getElementById('ck-start-btn');
    var rematchBtn = document.getElementById('ck-rematch-btn');
    if (startBtn) startBtn.classList.toggle('hidden', ckGameState !== 'waiting');
    if (rematchBtn) rematchBtn.classList.toggle('hidden', ckGameState !== 'over');
  }

  /* ── Click handling ── */

  function onCellClick(row, col) {
    if (ckGameState !== 'playing' || ckTurn !== ckMyColor) return;

    var vm = ckValidMoves.find(function (m) { return m.row === row && m.col === col; });
    if (vm && ckSelected) {
      send({
        type: 'ckMove',
        from: { row: ckSelected.row, col: ckSelected.col },
        to: { row: row, col: col }
      });
      ckSelected = null;
      ckValidMoves = [];
      renderBoard();
      return;
    }

    var piece = ckBoard[row][col];
    if (piece && piece.color === ckMyColor) {
      if (ckMustContinue &&
          (ckMustContinue.row !== row || ckMustContinue.col !== col)) return;
      ckSelected = { row: row, col: col };
      var mustCap = hasAnyCapture(ckBoard, ckMyColor);
      ckValidMoves = getValidMoves(ckBoard, row, col, ckMyColor, mustCap);
      renderBoard();
      return;
    }

    ckSelected = null;
    ckValidMoves = [];
    renderBoard();
  }

  /* ── WebSocket message handling ── */

  function handleMessage(msg) {
    switch (msg.type) {
      case 'ckGameStarted':
        ckGameState = 'playing';
        ckBoard = msg.board || emptyBoard();
        ckTurn = msg.turn || 'red';
        ckWinner = null;
        ckSelected = null;
        ckValidMoves = [];
        ckMustContinue = null;
        if (msg.players) {
          ckPlayers = msg.players;
          var me = ckPlayers.find(function (p) { return p.id === ckMyId; });
          if (me) ckMyColor = me.color;
        }
        setStatus(ckTurn === ckMyColor ? 'Your turn!' : 'Waiting for ' + ckTurn + '...');
        renderAll();
        break;

      case 'ckYourColor':
        ckMyColor = msg.color;
        renderAll();
        break;

      case 'ckBoardUpdate':
        ckBoard = msg.board;
        ckTurn = msg.turn;
        ckMustContinue = msg.mustContinue || null;
        ckSelected = null;
        ckValidMoves = [];

        if (ckMustContinue && ckTurn === ckMyColor) {
          ckSelected = { row: ckMustContinue.row, col: ckMustContinue.col };
          var cap = hasAnyCapture(ckBoard, ckMyColor);
          ckValidMoves = getValidMoves(
            ckBoard, ckMustContinue.row, ckMustContinue.col, ckMyColor, cap
          );
          setStatus('Continue jumping!');
        } else if (ckTurn === ckMyColor) {
          setStatus('Your turn!');
        } else {
          setStatus('Waiting for ' + ckTurn + '...');
        }
        renderAll();
        break;

      case 'ckGameOver': {
        ckGameState = 'over';
        ckWinner = msg.winner;
        ckSelected = null;
        ckValidMoves = [];
        ckMustContinue = null;
        var reason = msg.reason === 'capture' ? 'all pieces captured' : 'no legal moves';
        setStatus(
          ckWinner === ckMyColor
            ? 'You win! (' + reason + ')'
            : ckWinner + ' wins! (' + reason + ')'
        );
        renderAll();
        break;
      }

      case 'ckWaiting':
        ckGameState = 'waiting';
        setStatus('Waiting for opponent...');
        renderAll();
        break;

      case 'ckPlayerLeft':
        ckGameState = 'over';
        setStatus('Opponent disconnected');
        renderAll();
        break;
    }
  }

  /* ── Lifecycle ── */

  function init(ws, myId, players, roomKey) {
    ckWs = ws;
    ckMyId = myId;
    ckPlayers = players || [];
    ckRoomKey = roomKey || '';
    ckGameState = 'waiting';
    ckBoard = emptyBoard();
    ckTurn = null;
    ckSelected = null;
    ckValidMoves = [];
    ckWinner = null;
    ckMustContinue = null;
    ckMyColor = null;

    injectStyles();
    buildScreen();

    if (roomLabelEl) roomLabelEl.textContent = 'Checkers \u2014 ' + ckRoomKey;
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

  window.ckSetWs = function (ws) {
    ckWs = ws;
  };

  window.checkers = { init: init, handleMessage: handleMessage, show: show, hide: hide };
})();
