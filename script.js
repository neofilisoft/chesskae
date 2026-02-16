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

// Online
var currentRoom = null;
var isHost = false;
var myColor = 'white';
var syncTimer = null;
var lastMove = -1;

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

        if (!isHost) {
            myColor = (data.hostColor === 'white') ? 'black' : 'white';
        }
        playerColor = myColor;

        updatePlayerNames();
        startNewGame();
        if (myColor === 'black') board.flip();
    });

    socket.on('moveMade', function(move) {
        if (!currentRoom) return;
        game.move(move);
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
}

function onDrop(source, target) {
    if (source === target) {
        if (sourceSquare === source) {
            removeHighlights();
            sourceSquare = null;
            return;
        }
        
        var piece = game.get(source);
        if (piece && piece.color === game.turn()) {
            removeHighlights();
            sourceSquare = source;
            highlightSquare(source);
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

function startNewGame() {
    game.reset();
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
        
        $('#myBoard').on('click', '.square-55d63', function(e) {
            var square = $(this).attr('data-square');
            onSquareClick(square);
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
        $('#difficulty-display').text('Difficulty: ' + aiDifficulty);
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
        if (!socket || !socket.connected) 
        $('#mode-selection').addClass('hidden');
        $('#online-selection').removeClass('hidden');
    });

    $('#btnBackToMenu').on('click', function() {
        location.reload();
    });

    $('#btnNewGame').on('click', function() {
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
        playerColor = 'white';
        gameMode = 'pve';
        $('#color-selection').addClass('hidden');
        $('#game-container').removeClass('hidden');
        updatePlayerNames();
        startNewGame();
    });

    $('#btnBlack').on('click', function() {
        playerColor = 'black';
        gameMode = 'pve';
        $('#color-selection').addClass('hidden');
        $('#game-container').removeClass('hidden');
        updatePlayerNames();
        startNewGame();
    });

    $('#btnRandom').on('click', function() {
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
        navigator.clipboard.writeText(code).then(function() {
            alert('Code copied: ' + code);
        });
    });

    $('#btnCancelRoom').on('click', function() {
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
});


// === AI Logic ===

function makeBestMove() {
    if (game.game_over()) return;

    engineThinking = true;
    var aiColor = playerColor === 'white' ? 'b' : 'w';
    showThinking(aiColor);

    window.setTimeout(function() {
        var bestMove = minimaxRoot(aiDifficulty, game, true);
        game.move(bestMove);
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

function minimaxRoot(depth, game, isMaximisingPlayer) {
    var newGameMoves = game.moves();
    var bestMove = -9999;
    var bestMoveFound;

    for(var i = 0; i < newGameMoves.length; i++) {
        var newGameMove = newGameMoves[i];
        game.move(newGameMove);
        var value = minimax(depth - 1, game, -10000, 10000, !isMaximisingPlayer);
        game.undo();
        if(value >= bestMove) {
            bestMove = value;
            bestMoveFound = newGameMove;
        }
    }
    return bestMoveFound;
}

function minimax(depth, game, alpha, beta, isMaximisingPlayer) {
    if (depth === 0) {
        return -evaluateBoard(game.board());
    }

    var newGameMoves = game.moves();

    if (isMaximisingPlayer) {
        var bestMove = -9999;
        for (var i = 0; i < newGameMoves.length; i++) {
            game.move(newGameMoves[i]);
            bestMove = Math.max(bestMove, minimax(depth - 1, game, alpha, beta, !isMaximisingPlayer));
            game.undo();
            alpha = Math.max(alpha, bestMove);
            if (beta <= alpha) {
                return bestMove;
            }
        }
        return bestMove;
    } else {
        var bestMove = 9999;
        for (var i = 0; i < newGameMoves.length; i++) {
            game.move(newGameMoves[i]);
            bestMove = Math.min(bestMove, minimax(depth - 1, game, alpha, beta, !isMaximisingPlayer));
            game.undo();
            beta = Math.min(beta, bestMove);
            if (beta <= alpha) {
                return bestMove;
            }
        }
        return bestMove;
    }
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
