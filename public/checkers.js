(function () {
  'use strict';

  const SPRITE_SHEET = '/checkers/pieces.png';
  const BOARD_BG = '/checkers/boards/board_plain_01.png';
  const CURSOR_IMG = '/checkers/cursor.png';
  const MOVE_SFX = new Audio('/checker-move.ogg');
  const CAPTURE_SFX = new Audio('/checker-capture.ogg');
  const KING_SFX = new Audio('/checker-king.ogg');

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
  let ckTimerSeconds = 0;
  let ckTurnDeadline = 0;
  let ckTimerInterval = null;
  let ckCapturesRed = 0;
  let ckCapturesWhite = 0;

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

  function getValidMoves(board, row, col, color) {
    const piece = board[row][col];
    if (!piece || piece.color !== color) return [];

    const dirs = piece.king
      ? [[-1, -1], [-1, 1], [1, -1], [1, 1]]
      : color === 'red' ? [[-1, -1], [-1, 1]] : [[1, -1], [1, 1]];

    const results = [];

    for (const [dr, dc] of dirs) {
      const mr = row + dr, mc = col + dc;
      const jr = row + 2 * dr, jc = col + 2 * dc;

      if (jr >= 0 && jr < 8 && jc >= 0 && jc < 8 &&
          board[mr][mc] && board[mr][mc].color !== color && !board[jr][jc]) {
        results.push({ row: jr, col: jc, captured: { row: mr, col: mc } });
      }

      if (mr >= 0 && mr < 8 && mc >= 0 && mc < 8 && !board[mr][mc]) {
        results.push({ row: mr, col: mc });
      }
    }

    return results;
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

      '.ck-player-tag.ck-is-me{background:color-mix(in srgb, var(--lobby-accent) 30%, transparent)}' +

      '.ck-player-swatch{width:.7rem;height:.7rem;border:.0625rem solid #555;flex-shrink:0}' +

      '.ck-color-red{background:#444}' +
      '.ck-color-white{background:#eee}' +

      '.ck-player-name{color:#ddd}' +
      '.ck-captures{color:#888;font-size:.4rem;margin-left:.25rem}' +

      '.ck-board-wrap{flex:1;display:flex;align-items:center;justify-content:center;' +
        'min-height:0;padding:.5rem}' +

      '#ck-board{' +
        '--ck-size:min(calc(100vh - 9rem),calc(100vw - 2rem),42rem);' +
        'display:grid;grid-template-columns:repeat(8,1fr);grid-template-rows:repeat(8,1fr);' +
        'width:var(--ck-size);height:var(--ck-size);gap:0;aspect-ratio:1;flex-shrink:0;' +
        'border:.35rem solid #8b6914;outline:.2rem solid #000;' +
        'image-rendering:pixelated}' +

      '.ck-cell{position:relative;display:flex;align-items:center;' +
        'justify-content:center;cursor:default;user-select:none;aspect-ratio:1;overflow:hidden;' +
        'box-sizing:border-box;image-rendering:pixelated}' +
      '.ck-cell.ck-dark{background:#6b5a42}' +
      '.ck-cell.ck-light{background:#d4c49a}' +

      ".ck-cell.ck-clickable{cursor:url('" + CURSOR_IMG + "') 8 8,pointer}" +

      '.ck-piece{width:78%;height:78%;max-width:78%;max-height:78%;aspect-ratio:1;flex-shrink:0;' +
        "background-image:url('" + SPRITE_SHEET + "');" +
        'background-size:400% 100%;background-repeat:no-repeat;' +
        'image-rendering:pixelated;pointer-events:none;' +
        'transition:transform .12s ease,filter .12s ease}' +

      '.ck-piece.ck-selected{transform:scale(1.15);' +
        'outline:.15rem solid #ffd700;outline-offset:.05rem}' +

      '.ck-valid-move::after{content:"";position:absolute;inset:0;margin:auto;' +
        'width:24%;height:24%;max-width:24%;max-height:24%;aspect-ratio:1;' +
        'background:rgba(255,215,0,.75);pointer-events:none;z-index:2;' +
        'transform:rotate(45deg);image-rendering:pixelated}' +

      '.ck-valid-capture::after{content:"";position:absolute;inset:0;margin:auto;' +
        'width:55%;height:55%;max-width:55%;max-height:55%;aspect-ratio:1;' +
        'border:.2rem solid rgba(255,70,70,.85);' +
        'pointer-events:none;z-index:2;image-rendering:pixelated}' +

      '.ck-timer-setting{display:flex;align-items:center;gap:.4rem;font-size:.45rem}' +
      '.ck-timer-setting.hidden{display:none}' +
      '.ck-timer-setting label{color:#888}' +
      ".ck-timer-setting select{font-family:'Press Start 2P',monospace;" +
        'font-size:.4rem;background:#1a1a1a;color:#ddd;border:.1rem solid #333;' +
        'border-radius:.2rem;padding:.2rem .3rem;cursor:pointer}' +

      '.ck-turn-timer{font-size:.8rem;color:#ffd700;text-align:center;' +
        'padding:.2rem .5rem;letter-spacing:.05rem}' +
      '.ck-turn-timer.hidden{display:none}' +
      '.ck-turn-timer.ck-timer-urgent{color:#ff4444;animation:ckTimerBlink .5s ease-in-out infinite}' +
      '@keyframes ckTimerBlink{0%,100%{opacity:1}50%{opacity:.4}}';

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
      '<div class="ck-room-bar">' +
        '<button type="button" id="ck-back-btn" class="btn-back-inline" title="Back to game selection"><img src="icon-home.png" alt="" class="btn-back-icon"> Lobby</button>' +
        '<span id="ck-room-label"></span>' +
        '<div class="ck-timer-setting" id="ck-timer-setting">' +
          '<label for="ck-timer-select">Turn timer</label>' +
          '<select id="ck-timer-select">' +
            '<option value="0">No timer</option>' +
            '<option value="5">5 sec</option>' +
            '<option value="10">10 sec</option>' +
            '<option value="15">15 sec</option>' +
            '<option value="30">30 sec</option>' +
            '<option value="60">60 sec</option>' +
          '</select>' +
        '</div>' +
        '<button id="ck-start-btn" class="btn-start">Start Game</button>' +
        '<button id="ck-rematch-btn" class="btn-restart hidden">Rematch</button>' +
        '<button type="button" id="ck-radio-btn" class="btn-radio" title="Radio" aria-label="Radio">&#x1F4FB;</button>' +
      '</div>' +
      '<div id="ck-turn-timer" class="ck-turn-timer hidden"></div>' +
      '<div id="ck-status"></div>' +
      '<div id="ck-players-area"></div>' +
      '<div class="ck-board-wrap"><div id="ck-board"></div></div>' +
      '<div class="now-playing-radio hidden" id="ck-now-playing-radio">' +
        '<span class="now-playing-label" id="ck-now-playing-radio-label"></span>' +
        '<button type="button" class="now-playing-stop" id="ck-radio-stop" title="Stop radio">&#x25A0;</button>' +
      '</div>';

    document.body.appendChild(screenEl);

    var backBtn = document.getElementById('ck-back-btn');
    if (backBtn) backBtn.addEventListener('click', function () {
      send({ type: 'backToLobby' });
    });
    var startBtn = document.getElementById('ck-start-btn');
    if (startBtn) startBtn.addEventListener('click', function () {
      var sel = document.getElementById('ck-timer-select');
      var timer = sel ? parseInt(sel.value, 10) : 0;
      send({ type: 'startGame', gameType: 'checkers', timerSeconds: timer });
    });
    var rematchBtn = document.getElementById('ck-rematch-btn');
    if (rematchBtn) rematchBtn.addEventListener('click', function () {
      var sel = document.getElementById('ck-timer-select');
      var timer = sel ? parseInt(sel.value, 10) : 0;
      send({ type: 'startGame', gameType: 'checkers', timerSeconds: timer });
    });
    var ckRadioBtn = document.getElementById('ck-radio-btn');
    if (ckRadioBtn) ckRadioBtn.addEventListener('click', function () {
      var overlay = document.getElementById('radio-overlay');
      var searchInput = document.getElementById('radio-search');
      if (overlay) overlay.classList.remove('hidden');
      if (searchInput) searchInput.focus();
    });
    var ckRadioStop = document.getElementById('ck-radio-stop');
    if (ckRadioStop) ckRadioStop.addEventListener('click', function () {
      if (ckWs && ckWs.readyState === WebSocket.OPEN) {
        ckWs.send(JSON.stringify({ type: 'stopRadio' }));
      }
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
        } else if (myTurn && piece && piece.color === ckMyColor) {
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
      if (p.color) {
        var cap = document.createElement('span');
        cap.className = 'ck-captures';
        cap.textContent = ' ' + (p.color === 'red' ? ckCapturesRed : ckCapturesWhite) + ' captured';
        tag.appendChild(cap);
      }

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
    var timerSetting = document.getElementById('ck-timer-setting');
    if (startBtn) startBtn.classList.toggle('hidden', ckGameState !== 'waiting');
    if (rematchBtn) rematchBtn.classList.toggle('hidden', ckGameState !== 'over');
    if (timerSetting) timerSetting.classList.toggle('hidden', ckGameState === 'playing');
  }

  /* ── Timer display ── */

  function startCkTimer(deadline) {
    stopCkTimer();
    ckTurnDeadline = deadline;
    if (!deadline) return;
    updateCkTimerDisplay();
    ckTimerInterval = setInterval(updateCkTimerDisplay, 200);
  }

  function stopCkTimer() {
    if (ckTimerInterval) { clearInterval(ckTimerInterval); ckTimerInterval = null; }
    ckTurnDeadline = 0;
    var el = document.getElementById('ck-turn-timer');
    if (el) el.classList.add('hidden');
  }

  function updateCkTimerDisplay() {
    var el = document.getElementById('ck-turn-timer');
    if (!el || !ckTurnDeadline) return;
    var remaining = Math.max(0, Math.ceil((ckTurnDeadline - Date.now()) / 1000));
    el.textContent = remaining + 's';
    el.classList.remove('hidden');
    el.classList.toggle('ck-timer-urgent', remaining <= 3);
    if (remaining <= 0) stopCkTimer();
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
      ckSelected = { row: row, col: col };
      ckValidMoves = getValidMoves(ckBoard, row, col, ckMyColor);
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
        ckCapturesRed = 0;
        ckCapturesWhite = 0;
        ckBoard = msg.board || emptyBoard();
        ckTurn = msg.turn || 'red';
        ckWinner = null;
        ckSelected = null;
        ckValidMoves = [];
        ckMustContinue = null;
        ckTimerSeconds = msg.timerSeconds || 0;
        if (msg.players) {
          ckPlayers = msg.players;
          var me = ckPlayers.find(function (p) { return p.id === ckMyId; });
          if (me) ckMyColor = me.color;
        }
        setStatus(ckTurn === ckMyColor ? 'Your turn!' : 'Waiting for ' + ckTurn + '...');
        if (ckTimerSeconds > 0 && msg.turnDeadline) {
          startCkTimer(msg.turnDeadline);
        } else {
          stopCkTimer();
        }
        renderAll();
        break;

      case 'ckYourColor':
        ckMyColor = msg.color;
        renderAll();
        break;

      case 'ckBoardUpdate':
        ckBoard = msg.board;
        ckTurn = msg.turn;
        ckSelected = null;
        ckValidMoves = [];
        var vol = parseInt(localStorage.getItem('poker_card_fx_volume'), 10);
        var volNorm = (isNaN(vol) ? 80 : Math.max(0, Math.min(100, vol))) / 100;
        if (msg.lastMove && msg.lastMove.captured) {
          var capturerColor = msg.turn === 'red' ? 'white' : 'red';
          if (capturerColor === 'red') ckCapturesRed++; else ckCapturesWhite++;
        }
        if (msg.promoted) {
          try { if (typeof playSfx === 'function') playSfx(KING_SFX, volNorm); else { KING_SFX.volume = volNorm; KING_SFX.currentTime = 0; KING_SFX.play(); } } catch (_) {}
        } else if (msg.lastMove && msg.lastMove.captured) {
          try { if (typeof playSfx === 'function') playSfx(CAPTURE_SFX, volNorm); else { CAPTURE_SFX.volume = volNorm; CAPTURE_SFX.currentTime = 0; CAPTURE_SFX.play(); } } catch (_) {}
        } else if (msg.lastMove) {
          try { if (typeof playSfx === 'function') playSfx(MOVE_SFX, volNorm); else { MOVE_SFX.volume = volNorm; MOVE_SFX.currentTime = 0; MOVE_SFX.play(); } } catch (_) {}
        }

        if (ckTurn === ckMyColor) {
          setStatus('Your turn!');
        } else {
          setStatus('Waiting for ' + ckTurn + '...');
        }
        if (ckTimerSeconds > 0 && msg.turnDeadline) {
          startCkTimer(msg.turnDeadline);
        } else {
          stopCkTimer();
        }
        renderAll();
        break;

      case 'ckGameOver': {
        ckGameState = 'over';
        ckWinner = msg.winner;
        ckSelected = null;
        ckValidMoves = [];
        ckMustContinue = null;
        stopCkTimer();
        var reasonMap = { capture: 'all pieces captured', noMoves: 'no legal moves', timeout: 'time ran out' };
        var reason = reasonMap[msg.reason] || msg.reason;
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
        ckCapturesRed = 0;
        ckCapturesWhite = 0;
        stopCkTimer();
        setStatus('Waiting for opponent...');
        renderAll();
        break;

      case 'ckPlayerLeft':
        ckGameState = 'over';
        stopCkTimer();
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
    ckCapturesRed = 0;
    ckCapturesWhite = 0;
    ckBoard = emptyBoard();
    ckTurn = null;
    ckSelected = null;
    ckValidMoves = [];
    ckWinner = null;
    ckMustContinue = null;
    ckMyColor = null;
    ckTimerSeconds = 0;
    ckTurnDeadline = 0;
    stopCkTimer();

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
