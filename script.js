var board = null;
var game = new Chess();
var $status = $('#status');
var $pgn = $('#pgn-display');
var sourceSquare = null;
var destinationSquare = null;
var moveSound = new Audio('sfx/Move.ogg');
var checkSound = new Audio('sfx/Check.ogg');
var checkmateSound = new Audio('sfx/Checkmate.ogg');

var gameMode = 'pvp';
var playerColor = 'white';
var engineThinking = false;
var showHints = true;
var aiDifficulty = 2;
var aiDifficultyNames = ['Easy', 'Normal', 'Hard', 'Master'];

// Online
var currentRoom = null;
var isHost = false;
var myColor = 'white';
var syncTimer = null;
var lastMove = -1;
var onlineClockTimer = null;
var onlineTurnColor = 'white';
var onlineTurnDeadline = 0;
var onlineTurnTimeMs = 90000;
var onlineTimedOut = false;
var aiSearchDeadline = 0;
var aiSearchAborted = false;
var aiTranspositionTable = Object.create(null);

moveSound.volume = 0.3;
checkSound.volume = 0.3;
checkmateSound.volume = 0.3;

var pieceValues = {
    'p': 100,
    'n': 300,
    'b': 320,
    'r': 400,
    'q': 800,
    'k': 10000
};

// Self-hosted / external server (Socket.IO)
var socket = null;

function getServerUrl() {
    // Priority: ?server=  -> localStorage -> localhost (dev) -> empty (disable online)
    try {
        const qs = new URLSearchParams(window.location.search);
        const fromQuery = qs.get('server');
        if (fromQuery && fromQuery.trim()) {
            const u = fromQuery.trim().replace(/\/$/, '');
            localStorage.setItem('CHESSKAE_SERVER_URL', u);
            return u;
        }
        const saved = localStorage.getItem('CHESSKAE_SERVER_URL');
        if (saved && saved.trim()) return saved.trim().replace(/\/$/, '');
    } catch (e) {}

    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        return "http://localhost:3000";
    }
    return ""; // production requires explicit server url
}

function ensureSocketConnected() {
    const SERVER_URL = getServerUrl();

    if (socket && socket.connected) return true;

    if (!SERVER_URL) {
        alert('Online server ยังไม่ได้ตั้งค่า\n\nใส่ URL ผ่าน ?server=https://YOUR-SERVER หรือบันทึกไว้ใน localStorage key: CHESSKAE_SERVER_URL');
        return false;
    }

    try {
        if (!socket) {
            socket = io(SERVER_URL, {
                transports: ['websocket', 'polling'],
                reconnection: true,
                reconnectionDelay: 1000,
                reconnectionDelayMax: 5000,
                reconnectionAttempts: 10,
                timeout: 8000
            });

            socket.on('connect', () => console.log('Connected to server:', SERVER_URL));
            socket.on('connect_error', (error) => console.warn('Socket connection error:', error));

            registerOnlineListeners(); // register once
        } else {
            socket.connect();
        }
        return true;
    } catch (e) {
        console.warn('Socket.IO initialization failed:', e);
        socket = null;
        return false;
    }
}

// === ONLINE FUNCTIONS ===
function createRoom(color) {
    if (!ensureSocketConnected()) return;
    myColor = color;
    isHost = true;
    socket.emit('createRoom', { color: color });
}

function joinRoom(code) {
    if (!ensureSocketConnected()) return;
    isHost = false;
    socket.emit('joinRoom', String(code || '').trim().toUpperCase());
}

// === SOCKET LISTENERS ===
function registerOnlineListeners() {
    if (!socket) return;

    // prevent duplicate handler stacking
    socket.off('roomCreated');
    socket.off('startGame');
    socket.off('moveMade');
    socket.off('error');
    socket.off('playerDisconnected');
    socket.off('joinedRoomFailed');
    socket.off('newGameRequested');
    socket.off('roomCancelled');
    socket.off('clockUpdate');
    socket.off('gameTimeout');

    socket.on('roomCreated', function(code) {
        currentRoom = code;
        $('#create-room').addClass('hidden');
        $('#room-code').removeClass('hidden');
        $('#room-code-display').text(code);
    });

    socket.on('startGame', function(data) {
        currentRoom = data.roomCode;
        $('#room-code').addClass('hidden');
        $('#join-room').addClass('hidden');
        $('#game-container').removeClass('hidden');
        gameMode = 'online';

        myColor = data.players && socket.id ? data.players[socket.id] :
            (isHost ? data.hostColor : (data.hostColor === 'white' ? 'black' : 'white'));
        playerColor = myColor;

        updatePlayerNames();
        startNewGame();
        startOnlineClock(data.turnColor || 'white', data.turnDeadline, data.turnTimeMs || 90000);
    });

    socket.on('moveMade', function(payload) {
        if (!currentRoom) return;
        var move = payload && payload.move ? payload.move : payload;
        if (!game.move(move)) return;
        board.position(game.fen());
        updateStatus();
        if (game.in_checkmate()) checkmateSound.play().catch(e => {});
        else if (game.in_check()) checkSound.play().catch(e => {});
        else moveSound.play().catch(e => {});
    });

    socket.on('joinedRoomFailed', function(msg) {
        alert(msg || 'ไม่พบห้อง');
    });

    socket.on('error', function(msg) {
        alert(msg);
    });

    socket.on('playerDisconnected', function() {
        alert('ฝ่ายตรงข้ามออกจากเกม');
        location.reload();
    });

    socket.on('newGameRequested', function(data) {
        startNewGame();
        startOnlineClock(data && data.turnColor || 'white', data && data.turnDeadline, data && data.turnTimeMs || 90000);
    });

    socket.on('clockUpdate', function(data) {
        if (!data) return;
        startOnlineClock(data.turnColor, data.turnDeadline, onlineTurnTimeMs);
    });

    socket.on('gameTimeout', function(data) {
        onlineTimedOut = true;
        stopOnlineClock();
        var loser = data && data.loser ? data.loser : 'ผู้เล่น';
        var winner = data && data.winner ? data.winner : '';
        var result = loser === myColor ? 'คุณแพ้' : 'คุณชนะ';
        $status.text('Time Out — ' + loser + ' หมดเวลา (' + result + (winner ? ', ' + winner + ' ชนะ' : '') + ')');
        updateClockDisplay(0, loser);
        removeHighlights();
    });

    socket.on('roomCancelled', function() {
        currentRoom = null;
        $('#room-code').addClass('hidden');
        $('#online-selection').removeClass('hidden');
    });
}

function onDrop(source, target) {
    if (gameMode === 'online' && (onlineTimedOut || Date.now() >= onlineTurnDeadline)) return 'snapback';
    if (source === target) {
        // Tap on same square (common on mobile / touch)
        if (sourceSquare === source) {
            removeHighlights();
            sourceSquare = null;
            return;
        }
        
        var piece = game.get(source);
        if (piece && piece.color === game.turn()) {
            if (gameMode === 'pve' && engineThinking) return;
            if (gameMode === 'online') {
                if (game.turn() === 'w' && myColor === 'black') return;
                if (game.turn() === 'b' && myColor === 'white') return;
            }
            removeHighlights();
            sourceSquare = source;
            highlightSquare(source);
            if (showHints) {
                var moves = game.moves({ square: source, verbose: true });
                for (var i = 0; i < moves.length; i++) {
                    addHint(moves[i].to);
                }
            }
            return;
        }
        return;
    }

    removeHighlights();
    
    if (isPromotion(source, target)) {
        sourceSquare = source;
        destinationSquare = target;
        $('#promotion-dialog').removeClass('hidden');
        return;
    }

    var result = executeMove(source, target);
    if (result === 'snapback') return 'snapback';
}

function onSquareClick(square) {
    if (gameMode === 'online' && (onlineTimedOut || Date.now() >= onlineTurnDeadline)) return;
    if (sourceSquare === null) {
        var piece = game.get(square);
        if (piece && piece.color === game.turn()) {
            if (gameMode === 'pve' && engineThinking) return;
            if (gameMode === 'online') {
                if (game.turn() === 'w' && myColor === 'black') return;
                if (game.turn() === 'b' && myColor === 'white') return;
            }
            
            sourceSquare = square;
            highlightSquare(square);
            
            if (showHints) {
                var moves = game.moves({ square: square, verbose: true });
                for (var i = 0; i < moves.length; i++) {
                    addHint(moves[i].to);
                }
            }
        }
    } 
    else {
        if (square === sourceSquare) {
            removeHighlights();
            sourceSquare = null;
            return;
        }
        
        if (isPromotion(sourceSquare, square)) {
            destinationSquare = square;
            $('#promotion-dialog').removeClass('hidden');
            return;
        }
        
        var result = executeMove(sourceSquare, square);
        if (result === 'snapback') {
            var piece = game.get(square);
            if (piece && piece.color === game.turn()) {
                removeHighlights();
                sourceSquare = square;
                highlightSquare(square);
                
                if (showHints) {
                    var moves = game.moves({ square: square, verbose: true });
                    for (var i = 0; i < moves.length; i++) {
                        addHint(moves[i].to);
                    }
                }
            } else {
                removeHighlights();
                sourceSquare = null;
            }
        }
    }
}

function executeMove(source, target) {
    if (gameMode === 'online' && (onlineTimedOut || Date.now() >= onlineTurnDeadline)) return 'snapback';
    var move = game.move({
        from: source,
        to: target,
        promotion: 'q'
    });

    if (move === null) return 'snapback';

    if (gameMode === 'online' && currentRoom) {
        socket.emit('makeMove', { code: currentRoom, move: move });
    }
   
    board.position(game.fen());
    updateStatus();
    
    if (game.in_checkmate()) {
        checkmateSound.play().catch(e => {});
    } else if (game.in_check()) {
        checkSound.play().catch(e => {});
    } else {
        moveSound.play().catch(e => {});
    }

    sourceSquare = null;
    destinationSquare = null;
    removeHighlights();

    if (gameMode === 'pve' && !game.game_over()) {
        setTimeout(makeBestMove, 250);
    }
}

function isPromotion(source, target) {
    var piece = game.get(source);
    if (!piece || piece.type !== 'p') return false;
    if (piece.color === 'w' && target.charAt(1) === '8') return true;
    if (piece.color === 'b' && target.charAt(1) === '1') return true;
    return false;
}

function choosePromotion(pieceType) {
    if (gameMode === 'online' && (onlineTimedOut || Date.now() >= onlineTurnDeadline)) {
        $('#promotion-dialog').addClass('hidden');
        return;
    }
    $('#promotion-dialog').addClass('hidden');
    
    var move = game.move({
        from: sourceSquare,
        to: destinationSquare,
        promotion: pieceType
    });

    if (move === null) return;

    if (gameMode === 'online' && currentRoom) {
        socket.emit('makeMove', { code: currentRoom, move: move });
    }

    board.position(game.fen());
    updateStatus();
    
    if (game.in_checkmate()) {
        checkmateSound.play().catch(e => {});
    } else if (game.in_check()) {
        checkSound.play().catch(e => {});
    } else {
        moveSound.play().catch(e => {});
    }
    
    sourceSquare = null;
    destinationSquare = null;
    removeHighlights();

    if (gameMode === 'pve' && !game.game_over()) {
        setTimeout(makeBestMove, 250);
    }
}

function onMouseoverSquare(square, piece) {
    if (!showHints) return;
    if (sourceSquare) return;
    
    var moves = game.moves({ square: square, verbose: true });
    if (moves.length === 0) return;

    for (var i = 0; i < moves.length; i++) {
        addHint(moves[i].to);
    }
}

function onMouseoutSquare(square, piece) {
    if (sourceSquare) return;
    removeHighlights();
}

function highlightSquare(square) {
    var $square = $('#myBoard .square-' + square);
    $square.addClass('highlight-selected');
}

function addHint(square) {
    var $square = $('#myBoard .square-' + square);
    var piece = game.get(square);
    
    if (piece) {
        $square.append('<div class="hint-ring"></div>');
    } else {
        $square.append('<div class="hint-circle"></div>');
    }
}

function removeHighlights() {
    $('#myBoard .square-55d63').removeClass('highlight-selected');
    $('.hint-circle').remove();
    $('.hint-ring').remove();
}

function onSnapEnd() {
    board.position(game.fen());
}
function onDragStart(source, piece, position, orientation) {
    if (game.game_over()) return false;
    if (gameMode === 'pve' && engineThinking) return false;
    if (gameMode === 'online' && (onlineTimedOut || Date.now() >= onlineTurnDeadline)) return false;

    // Only allow dragging the side whose turn it is
    if ((game.turn() === 'w' && piece.search(/^b/) !== -1) ||
        (game.turn() === 'b' && piece.search(/^w/) !== -1)) {
        return false;
    }

    // Online: only allow dragging your own pieces
    if (gameMode === 'online') {
        if (myColor === 'white' && piece.search(/^b/) !== -1) return false;
        if (myColor === 'black' && piece.search(/^w/) !== -1) return false;
        // Also block if it is not your turn
        if (game.turn() === 'w' && myColor === 'black') return false;
        if (game.turn() === 'b' && myColor === 'white') return false;
    }

    return true;
}

function formatClock(milliseconds) {
    var totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
    var minutes = Math.floor(totalSeconds / 60);
    var seconds = totalSeconds % 60;
    return String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0');
}

function updateClockDisplay(remainingMs, activeColor) {
    var colors = ['white', 'black'];
    colors.forEach(function(color) {
        var $clock = $('#' + color + '-clock');
        $clock.removeClass('active expired');
        $clock.text(color === activeColor ? formatClock(remainingMs) : formatClock(onlineTurnTimeMs));
        if (color === activeColor) $clock.addClass('active');
        if (color === activeColor && remainingMs <= 0) $clock.addClass('expired');
    });
}

function stopOnlineClock() {
    if (onlineClockTimer) {
        clearInterval(onlineClockTimer);
        onlineClockTimer = null;
    }
}

function startOnlineClock(turnColor, deadline, turnTimeMs) {
    if (gameMode !== 'online' || !deadline) return;
    stopOnlineClock();
    onlineTimedOut = false;
    onlineTurnColor = turnColor || 'white';
    onlineTurnDeadline = Number(deadline);
    onlineTurnTimeMs = Number(turnTimeMs) || 90000;
    $('#' + onlineTurnColor + '-clock').removeClass('hidden');
    $('#' + (onlineTurnColor === 'white' ? 'black' : 'white') + '-clock').removeClass('hidden');

    var tick = function() {
        var remaining = Math.max(0, onlineTurnDeadline - Date.now());
        updateClockDisplay(remaining, onlineTurnColor);
        if (remaining <= 0) {
            onlineTimedOut = true;
            stopOnlineClock();
        }
    };
    tick();
    onlineClockTimer = setInterval(tick, 250);
}

function startNewGame() {
    game.reset();
    if (gameMode !== 'online') {
        stopOnlineClock();
        onlineTimedOut = false;
        $('.clock').addClass('hidden');
    }
    if (board === null) {
        var config = {
            draggable: true,
            position: 'start',
            onDragStart: onDragStart,
            onDrop: onDrop,
            onMouseoutSquare: onMouseoutSquare,
            onMouseoverSquare: onMouseoverSquare,
            onSnapEnd: onSnapEnd,
            pieceTheme: 'https://lichess1.org/assets/piece/cburnett/{piece}.svg'
        };
        board = Chessboard('myBoard', config);
        
        // Desktop click-to-select. On touch devices chessboard fires onDrop(source===target)
        // which now also shows hints (see onDrop).
        $('#myBoard').on('click', '.square-55d63', function(e) {
            var square = $(this).attr('data-square');
            if (square) onSquareClick(square);
        });
    } else {
        board.start();
    }
    
    board.orientation(playerColor);

    if (gameMode === 'pve' && playerColor === 'black') {
        setTimeout(makeBestMove, 500);
    }
    
    updateStatus();
    updateGameModeDisplay();
}

function updateStatus() {
    var status = '';
    var moveColor = 'White';
    
    if (game.turn() === 'b') {
        moveColor = 'Black';
    }
    
    if (game.in_checkmate()) {
        status = 'Game over, ' + moveColor + ' is in checkmate.';
    } else if (game.in_draw()) {
        status = 'Game over, drawn position';
    } else {
        status = moveColor + ' to move';
        
        if (game.in_check()) {
            status += ', ' + moveColor + ' is in check';
        }
    }
    
    $status.html(status);
    var pgn = game.pgn();
    var formattedPgn = pgn.replace(/ (\d+\.)/g, '\n$1');
    $pgn.html(formattedPgn);
}

function updatePlayerNames() {
    if (gameMode === 'pvp') {
        $('#black-name').text('Player 2 (Black)');
        $('#white-name').text('Player 1 (White)');
    } else if (gameMode === 'pve') {
        if (playerColor === 'white') {
            $('#black-name').text('AI (Black)');
            $('#white-name').text('You (White)');
        } else {
            $('#black-name').text('You (Black)');
            $('#white-name').text('AI (White)');
        }
    } else if (gameMode === 'online') {
        if (myColor === 'white') {
            $('#black-name').text('Opponent (Black)');
            $('#white-name').text('You (White)');
        } else {
            $('#black-name').text('You (Black)');
            $('#white-name').text('Opponent (White)');
        }
    }
}

function updateGameModeDisplay() {
    var modeText = 'Mode: ';
    if (gameMode === 'pvp') {
        modeText += 'Player vs Player';
    } else if (gameMode === 'pve') {
        modeText += 'Player vs AI';
    } else if (gameMode === 'online') {
        modeText += 'Online Match';
    }
    $('#game-mode-display').text(modeText);
    
    if (gameMode === 'pve') {
        $('#difficulty-display').text('AI: ' + aiDifficultyNames[aiDifficulty - 1]);
    } else {
        $('#difficulty-display').text('');
    }
}

$(document).ready(function() {
    $('#btnPvP').on('click', function() {
        gameMode = 'pvp';
        $('#mode-selection').addClass('hidden');
        $('#game-container').removeClass('hidden');
        updatePlayerNames();
        startNewGame();
    });

    $('#btnPvE').on('click', function() {
        $('#mode-selection').addClass('hidden');
        $('#color-selection').removeClass('hidden');
    });

    $('#btnOnline').on('click', function() {
        $('#mode-selection').addClass('hidden');
        $('#online-selection').removeClass('hidden');
    });

    $('#btnBackToMenu').on('click', function() {
        location.reload();
    });

    $('#btnNewGame').on('click', function() {
        if (gameMode === 'online' && currentRoom && socket) {
            socket.emit('requestNewGame', { code: currentRoom });
            return;
        }
        startNewGame();
    });

    $('#btnFlip').on('click', function() {
        board.flip();
    });

    $('#btnBackToMode').on('click', function() {
        $('#color-selection').addClass('hidden');
        $('#mode-selection').removeClass('hidden');
    });

    $('#btnCreateRoom').on('click', function() {
        $('#online-selection').addClass('hidden');
        $('#create-room').removeClass('hidden');
    });

    $('#btnJoinRoom').on('click', function() {
        $('#online-selection').addClass('hidden');
        $('#join-room').removeClass('hidden');
    });

    $('#btnWhite').on('click', function() {
        setAiDifficulty($('#ai-difficulty-select').val());
        playerColor = 'white';
        gameMode = 'pve';
        $('#color-selection').addClass('hidden');
        $('#game-container').removeClass('hidden');
        updatePlayerNames();
        startNewGame();
    });

    $('#btnBlack').on('click', function() {
        setAiDifficulty($('#ai-difficulty-select').val());
        playerColor = 'black';
        gameMode = 'pve';
        $('#color-selection').addClass('hidden');
        $('#game-container').removeClass('hidden');
        updatePlayerNames();
        startNewGame();
    });

    $('#btnRandom').on('click', function() {
        setAiDifficulty($('#ai-difficulty-select').val());
        playerColor = Math.random() < 0.5 ? 'white' : 'black';
        gameMode = 'pve';
        $('#color-selection').addClass('hidden');
        $('#game-container').removeClass('hidden');
        updatePlayerNames();
        startNewGame();
    });

    $('#btnCreateWhite').on('click', function() {
        createRoom('white');
    });

    $('#btnCreateBlack').on('click', function() {
        createRoom('black');
    });

    $('#btnCopyCode').on('click', function() {
        var code = $('#room-code-display').text();
        var copy = navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(code) : Promise.reject();
        copy.then(function() {
            alert('Code copied: ' + code);
        }).catch(function() {
            $('#room-code-display').text(code + ' (เลือกและคัดลอก)');
        });
    });

    $('#btnCancelRoom').on('click', function() {
        if (socket && currentRoom) socket.emit('cancelRoom', currentRoom);
        currentRoom = null;
        $('#room-code').addClass('hidden');
        $('#online-selection').removeClass('hidden');
    });

    $('#btnJoinConfirm').on('click', function() {
        var code = $('#room-input').val().toUpperCase().trim();
        if (!code) {
            $('#join-error').removeClass('hidden').text('Please enter a room code');
            return;
        }
        $('#join-error').addClass('hidden');
        joinRoom(code);
    });

    $('#btnBackOnline').on('click', function() {
        $('#online-selection').addClass('hidden');
        $('#mode-selection').removeClass('hidden');
    });

    $('#btnBackCreate').on('click', function() {
        $('#create-room').addClass('hidden');
        $('#online-selection').removeClass('hidden');
    });

    $('#btnBackJoin').on('click', function() {
        $('#join-room').addClass('hidden');
        $('#online-selection').removeClass('hidden');
        $('#room-input').val('');
        $('#join-error').addClass('hidden');
    });

    // Settings Dialog
    $('#btnSettings').on('click', function() {
        $('#settings-dialog').removeClass('hidden');
    });

    $('#btnCloseSettings').on('click', function() {
        $('#settings-dialog').addClass('hidden');
    });

    // Volume Control
    $('#volume-control').on('input', function() {
        var vol = $(this).val() / 100;
        moveSound.volume = vol;
        checkSound.volume = vol;
        checkmateSound.volume = vol;
        $('#vol-value').text($(this).val() + '%');
    });

    // Hint Toggle
    $('#btnHintOn').on('click', function() {
        showHints = true;
        $('#btnHintOn').addClass('active');
        $('#btnHintOff').removeClass('active');
    });

    $('#btnHintOff').on('click', function() {
        showHints = false;
        $('#btnHintOff').addClass('active');
        $('#btnHintOn').removeClass('active');
        removeHighlights();
    });

    $('#ai-difficulty').on('input', function() {
        setAiDifficulty($(this).val());
    });
});

function setAiDifficulty(level) {
    aiDifficulty = Math.max(1, Math.min(4, Number(level) || 2));
    $('#ai-difficulty').val(aiDifficulty);
    $('#ai-difficulty-select').val(aiDifficulty);
    $('#ai-level-value').text(aiDifficultyNames[aiDifficulty - 1]);
    updateGameModeDisplay();
}


// === AI Logic ===

function makeBestMove() {
    if (game.game_over()) return;

    engineThinking = true;
    var aiColor = playerColor === 'white' ? 'b' : 'w';
    showThinking(aiColor);

    window.setTimeout(function() {
        var bestMove = findBestMove(aiDifficulty, game);
        if (bestMove) game.move(bestMove);
        board.position(game.fen());
        updateStatus();
        
        if (game.in_checkmate()) {
            checkmateSound.play().catch(e => {});
        } else if (game.in_check()) {
            checkSound.play().catch(e => {});
        } else {
            moveSound.play().catch(e => {});
        }
        
        engineThinking = false;
        hideThinking(aiColor);
    }, 100);
}

function showThinking(color) {
    if (color === 'w') {
        $('#white-thinking').removeClass('hidden');
    } else {
        $('#black-thinking').removeClass('hidden');
    }
}

function hideThinking(color) {
    if (color === 'w') {
        $('#white-thinking').addClass('hidden');
    } else {
        $('#black-thinking').addClass('hidden');
    }
}

function findBestMove(depth, position) {
    // Master keeps its deeper search, but shares Hard's response budget.
    // Iterative deepening always returns the best fully completed depth.
    var timeBudgets = [250, 600, 900, 900];
    var budget = timeBudgets[Math.max(0, Math.min(3, depth - 1))];
    var rootMoves = orderedMoves(position);
    if (!rootMoves.length) return null;

    aiSearchDeadline = Date.now() + budget;
    aiSearchAborted = false;
    aiTranspositionTable = Object.create(null);
    var bestMove = rootMoves[0];

    for (var currentDepth = 1; currentDepth <= depth; currentDepth++) {
        var result = searchRoot(currentDepth, position, rootMoves);
        if (aiSearchAborted || !result) break;
        bestMove = result.move;
        rootMoves = result.moves;
    }
    return bestMove;
}

function searchRoot(depth, position, rootMoves) {
    var bestMove = null;
    var bestScore = -Infinity;
    var nextMoves = [];
    for (var i = 0; i < rootMoves.length; i++) {
        if (Date.now() >= aiSearchDeadline) {
            aiSearchAborted = true;
            return null;
        }
        position.move(rootMoves[i]);
        var score = -negamax(depth - 1, position, -Infinity, Infinity);
        position.undo();
        if (aiSearchAborted) return null;
        nextMoves.push({ move: rootMoves[i], score: score });
        if (score > bestScore || (score === bestScore && Math.random() < 0.15)) {
            bestScore = score;
            bestMove = rootMoves[i];
        }
    }
    nextMoves.sort(function(a, b) { return b.score - a.score; });
    return { move: bestMove, moves: nextMoves.map(function(item) { return item.move; }) };
}

function negamax(depth, position, alpha, beta) {
    if (Date.now() >= aiSearchDeadline) {
        aiSearchAborted = true;
        return 0;
    }
    if (position.in_checkmate()) return -100000 - depth;
    if (position.in_draw()) return 0;
    if (depth <= 0) return evaluateForSideToMove(position);

    var cacheKey = position.fen() + '|' + depth;
    var cached = aiTranspositionTable[cacheKey];
    if (cached !== undefined) return cached;

    var moves = orderedMoves(position);
    var best = -Infinity;
    for (var i = 0; i < moves.length; i++) {
        position.move(moves[i]);
        var score = -negamax(depth - 1, position, -beta, -alpha);
        position.undo();
        if (aiSearchAborted) return 0;
        best = Math.max(best, score);
        alpha = Math.max(alpha, score);
        if (alpha >= beta) break;
    }
    aiTranspositionTable[cacheKey] = best;
    return best;
}

function orderedMoves(position) {
    return position.moves({ verbose: true }).sort(function(a, b) {
        return moveOrder(b) - moveOrder(a);
    });
}

function moveOrder(move) {
    var score = move.captured ? 1000 + (pieceValues[move.captured] || 0) : 0;
    if (move.promotion) score += 800 + (pieceValues[move.promotion] || 0);
    if (move.flags && move.flags.indexOf('c') !== -1) score += 50;
    return score;
}

function evaluateForSideToMove(position) {
    var whiteScore = evaluateBoard(position.board());
    return position.turn() === 'w' ? whiteScore : -whiteScore;
}

function evaluateBoard(board) {
    var totalEvaluation = 0;
    for (var i = 0; i < 8; i++) {
        for (var j = 0; j < 8; j++) {
            totalEvaluation = totalEvaluation + getPieceValue(board[i][j], i ,j);
        }
    }
    return totalEvaluation;
}

function getPieceValue(piece, x, y) {
    if (piece === null) {
        return 0;
    }
    var getAbsoluteValue = function (piece, isWhite, x ,y) {
        if (piece.type === 'p') {
            return 10 + ( isWhite ? pawnEvalWhite[y][x] : pawnEvalBlack[y][x] );
        } else if (piece.type === 'r') {
            return 50 + ( isWhite ? rookEvalWhite[y][x] : rookEvalBlack[y][x] );
        } else if (piece.type === 'n') {
            return 30 + knightEval[y][x];
        } else if (piece.type === 'b') {
            return 30 + ( isWhite ? bishopEvalWhite[y][x] : bishopEvalBlack[y][x] );
        } else if (piece.type === 'q') {
            return 90 + evalQueen[y][x];
        } else if (piece.type === 'k') {
            return 900 + ( isWhite ? kingEvalWhite[y][x] : kingEvalBlack[y][x] );
        }
        return 0;
    };

    var absoluteValue = getAbsoluteValue(piece, piece.color === 'w', x ,y);
    return piece.color === 'w' ? absoluteValue : -absoluteValue;
}

var pawnEvalWhite = [
    [0.0,  0.0,  0.0,  0.0,  0.0,  0.0,  0.0,  0.0],
    [5.0,  5.0,  5.0,  5.0,  5.0,  5.0,  5.0,  5.0],
    [1.0,  1.0,  2.0,  3.0,  3.0,  2.0,  1.0,  1.0],
    [0.5,  0.5,  1.0,  2.5,  2.5,  1.0,  0.5,  0.5],
    [0.0,  0.0,  0.0,  2.0,  2.0,  0.0,  0.0,  0.0],
    [0.5, -0.5, -1.0,  0.0,  0.0, -1.0, -0.5,  0.5],
    [0.5,  1.0, 1.0,  -2.0, -2.0,  1.0,  1.0,  0.5],
    [0.0,  0.0,  0.0,  0.0,  0.0,  0.0,  0.0,  0.0]
];

var pawnEvalBlack = pawnEvalWhite.slice().reverse();

var knightEval = [
    [-5.0, -4.0, -3.0, -3.0, -3.0, -3.0, -4.0, -5.0],
    [-4.0, -2.0,  0.0,  0.0,  0.0,  0.0, -2.0, -4.0],
    [-3.0,  0.0,  1.0,  1.5,  1.5,  1.0,  0.0, -3.0],
    [-3.0,  0.5,  1.5,  2.0,  2.0,  1.5,  0.5, -3.0],
    [-3.0,  0.0,  1.5,  2.0,  2.0,  1.5,  0.0, -3.0],
    [-3.0,  0.5,  1.0,  1.5,  1.5,  1.0,  0.5, -3.0],
    [-4.0, -2.0,  0.0,  0.5,  0.5,  0.0, -2.0, -4.0],
    [-5.0, -4.0, -3.0, -3.0, -3.0, -3.0, -4.0, -5.0]
];

var bishopEvalWhite = [
    [ -2.0, -1.0, -1.0, -1.0, -1.0, -1.0, -1.0, -2.0],
    [ -1.0,  0.0,  0.0,  0.0,  0.0,  0.0,  0.0, -1.0],
    [ -1.0,  0.0,  0.5,  1.0,  1.0,  0.5,  0.0, -1.0],
    [ -1.0,  0.5,  0.5,  1.0,  1.0,  0.5,  0.5, -1.0],
    [ -1.0,  0.0,  1.0,  1.0,  1.0,  1.0,  0.0, -1.0],
    [ -1.0,  1.0,  1.0,  1.0,  1.0,  1.0,  1.0, -1.0],
    [ -1.0,  0.5,  0.0,  0.0,  0.0,  0.0,  0.5, -1.0],
    [ -2.0, -1.0, -1.0, -1.0, -1.0, -1.0, -1.0, -2.0]
];

var bishopEvalBlack = bishopEvalWhite.slice().reverse();

var rookEvalWhite = [
    [  0.0,  0.0,  0.0,  0.0,  0.0,  0.0,  0.0,  0.0],
    [  0.5,  1.0,  1.0,  1.0,  1.0,  1.0,  1.0,  0.5],
    [ -0.5,  0.0,  0.0,  0.0,  0.0,  0.0,  0.0, -0.5],
    [ -0.5,  0.0,  0.0,  0.0,  0.0,  0.0,  0.0, -0.5],
    [ -0.5,  0.0,  0.0,  0.0,  0.0,  0.0,  0.0, -0.5],
    [ -0.5,  0.0,  0.0,  0.0,  0.0,  0.0,  0.0, -0.5],
    [ -0.5,  0.0,  0.0,  0.0,  0.0,  0.0,  0.0, -0.5],
    [  0.0,   0.0, 0.0,  0.5,  0.5,  0.0,  0.0,  0.0]
];

var rookEvalBlack = rookEvalWhite.slice().reverse();

var evalQueen = [
    [ -2.0, -1.0, -1.0, -0.5, -0.5, -1.0, -1.0, -2.0],
    [ -1.0,  0.0,  0.0,  0.0,  0.0,  0.0,  0.0, -1.0],
    [ -1.0,  0.0,  0.5,  0.5,  0.5,  0.5,  0.0, -1.0],
    [ -0.5,  0.0,  0.5,  0.5,  0.5,  0.5,  0.0, -0.5],
    [  0.0,  0.0,  0.5,  0.5,  0.5,  0.5,  0.0, -0.5],
    [ -1.0,  0.5,  0.5,  0.5,  0.5,  0.5,  0.0, -1.0],
    [ -1.0,  0.0,  0.5,  0.0,  0.0,  0.0,  0.0, -1.0],
    [ -2.0, -1.0, -1.0, -0.5, -0.5, -1.0, -1.0, -2.0]
];

var kingEvalWhite = [
    [ -3.0, -4.0, -4.0, -5.0, -5.0, -4.0, -4.0, -3.0],
    [ -3.0, -4.0, -4.0, -5.0, -5.0, -4.0, -4.0, -3.0],
    [ -3.0, -4.0, -4.0, -5.0, -5.0, -4.0, -4.0, -3.0],
    [ -3.0, -4.0, -4.0, -5.0, -5.0, -4.0, -4.0, -3.0],
    [ -2.0, -3.0, -3.0, -4.0, -4.0, -3.0, -3.0, -2.0],
    [ -1.0, -2.0, -2.0, -2.0, -2.0, -2.0, -2.0, -1.0],
    [  2.0,  2.0,  0.0,  0.0,  0.0,  0.0,  2.0,  2.0 ],
    [  2.0,  3.0,  1.0,  0.0,  0.0,  1.0,  3.0,  2.0 ]
];

var kingEvalBlack = kingEvalWhite.slice().reverse();
