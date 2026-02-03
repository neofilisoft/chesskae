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

const SERVER_URL = "https://unmovingly-overcaustic-evon.ngrok-free.dev"; 
const socket = io(SERVER_URL);

// === ONLINE FUNCTIONS ===

// ฟังก์ชันสร้างห้อง (ส่งคำสั่งไป Server)
function createRoom(color) {
    socket.emit('createRoom', { color: color });
    myColor = color;
    isHost = true;
}

function joinRoom(code) {
    currentRoom = code;
    socket.emit('joinRoom', code);
}

// === SOCKET LISTENERS ===

// โชว์รหัส
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
    
    // ตั้งค่าสี
    if (!isHost) {
        myColor = data.hostColor === 'white' ? 'black' : 'white';
        playerColor = myColor;
    } else {
        playerColor = myColor;
    }
    
    updatePlayerNames();
    startNewGame();
    
    if (myColor === 'black') {
        board.flip();
    }
});

socket.on('moveMade', function(move) {
    game.move(move);
    board.position(game.fen());
    updateStatus();
    
    if (game.in_checkmate()) {
        checkmateSound.play().catch(e => {});
    } else if (game.in_check()) {
        checkSound.play().catch(e => {});
    } else {
        moveSound.play().catch(e => {});
    }
});

// 4. แจ้งเตือน Error หรือหลุด
socket.on('error', function(msg) {
    alert(msg);
});

socket.on('playerDisconnected', function() {
    alert('ฝ่ายตรงข้ามออกจากเกม');
    location.reload();
});

function onDragStart (source, piece, position, orientation) {
    if (game.game_over()) return false;
    if (gameMode === 'pve' && engineThinking) return false;

    // Online: ห้ามเดินถ้าไม่ใช่ตาเรา หรือไม่ใช่สีเรา
    if (gameMode === 'online') {
        if (game.turn() === 'w' && myColor === 'black') return false;
        if (game.turn() === 'b' && myColor === 'white') return false;
        if (piece.search(myColor === 'white' ? /^b/ : /^w/) !== -1) return false;
    }

    if ((game.turn() === 'w' && piece.search(/^b/) !== -1) ||
        (game.turn() === 'b' && piece.search(/^w/) !== -1)) {
        return false;
    }
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
    if (piece.type !== 'p') return false;
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
    var moves = game.moves({ square: square, verbose: true });
    if (moves.length === 0) return;

    for (var i = 0; i < moves.length; i++) {
        addHint(moves[i].to);
    }
}

function onMouseoutSquare(square, piece) {
    removeHighlights();
    if (sourceSquare) {
        highlightSquare(sourceSquare);
    }
}

function highlightSquare(square) {
    var $square = $('#myBoard .square-' + square);
    $square.addClass('highlight');
}

function addHint(square) {
    var $square = $('#myBoard .square-' + square);
    $square.append('<div class="hint"></div>');
}

function removeHighlights() {
    $('#myBoard .square-55d63').removeClass('highlight');
    $('#myBoard .square-55d63 .hint').remove();
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

    $status.text(status);
    $pgn.html(game.pgn());
}

function updatePlayerNames() {
    if (gameMode === 'pve') {
        $('#top-player-name').text('Computer (Level ' + aiDifficulty + ')');
        $('#bottom-player-name').text('You');
    } else if (gameMode === 'online') {
        $('#top-player-name').text('Opponent');
        $('#bottom-player-name').text('You');
    } else {
        $('#top-player-name').text('Player 2 (Black)');
        $('#bottom-player-name').text('Player 1 (White)');
    }
}

var config = {
    draggable: true,
    position: 'start',
    onDragStart: onDragStart,
    onDrop: onDrop,
    onMouseoutSquare: onMouseoutSquare,
    onMouseoverSquare: onMouseoverSquare
};

function startNewGame() {
    game.reset();
    board.start();
    board.orientation(playerColor); 
    updateStatus();
    sourceSquare = null;
    destinationSquare = null;
    removeHighlights();
    
    if (gameMode === 'pve' && playerColor === 'black') {
        window.setTimeout(makeBestMove, 250);
    }
}

board = Chessboard('myBoard', config);
updateStatus();

// === UI Handlers ===

$('#btnPvP').on('click', function() {
    gameMode = 'pvp';
    playerColor = 'white';
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
    gameMode = 'online';
    $('#mode-selection').addClass('hidden');
    $('#online-menu').removeClass('hidden');
});

$('#btnCreateRoom').on('click', function() {
    $('#online-menu').addClass('hidden');
    $('#create-room').removeClass('hidden');
});

$('#btnJoinRoom').on('click', function() {
    $('#online-menu').addClass('hidden');
    $('#join-room').removeClass('hidden');
});

$('.color-btn').on('click', function() {
    var color = $(this).attr('data-color');
    
    if (gameMode === 'online') {
        // แก้ไข: เรียก createRoom ที่แก้แล้ว
        createRoom(color);
    } else {
        // PvE Logic
        playerColor = color;
        $('#color-selection').addClass('hidden');
        $('#game-container').removeClass('hidden');
        gameMode = 'pve';
        updatePlayerNames();
        startNewGame();
    }
});

// Join Confirm
$('#btnJoinConfirm').on('click', function() {
    var code = $('#room-input').val().toUpperCase().trim();
    if (!code) {
        $('#join-error').text('กรุณาใส่รหัส').removeClass('hidden');
        return;
    }
    $('#join-error').addClass('hidden');
    joinRoom(code);
});

$('#btnBackToMenu').on('click', function() {
    if (gameMode === 'online') {
        location.reload(); 
        return;
    }
    $('#game-container').addClass('hidden');
    $('#mode-selection').removeClass('hidden');
    game.reset();
    board.start();
    board.orientation('white');
    engineThinking = false;
    hideThinking('w');
    hideThinking('b');
});

$('.back-btn').on('click', function() {
    $(this).closest('.modal-overlay').addClass('hidden');
    
    if ($(this).closest('#create-room').length || $(this).closest('#join-room').length) {
        $('#online-menu').removeClass('hidden');
    } else {
        $('#mode-selection').removeClass('hidden');
    }
});

$('#myBoard').on('click', '.square-55d63', function() {
    var square = $(this).attr('data-square');

    if (!sourceSquare) return;

    var piece = game.get(square);
    if (!piece) {
        if (isPromotion(sourceSquare, square)) {
            destinationSquare = square;
            $('#promotion-dialog').removeClass('hidden');
        } else {
            executeMove(sourceSquare, square);
        }
    }
});

$('#btnNewGame').on('click', function() {
    startNewGame();
});

$('#btnFlip').on('click', function() {
    board.flip();
});

$('#btnSettings').on('click', function() {
    $('#settings-dialog').removeClass('hidden');
});

$('#btnCloseSettings').on('click', function() {
    $('#settings-dialog').addClass('hidden');
});

$('#volume-control').on('input', function() {
    var vol = $(this).val();
    var decimalVol = vol / 100;
    
    moveSound.volume = decimalVol;
    checkSound.volume = decimalVol;
    checkmateSound.volume = decimalVol;
    
    $('#vol-value').text(vol + '%');
});

$('#btnHintOn').on('click', function() {
    showHints = true;
    $(this).addClass('active');
    $('#btnHintOff').removeClass('active');
});

$('#btnHintOff').on('click', function() {
    showHints = false;
    $(this).addClass('active');
    $('#btnHintOn').removeClass('active');
    removeHighlights();
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
    var $playerInfo = color === 'w' ? $('#bottom-player-name') : $('#top-player-name');
    $playerInfo.append('<span class="thinking"> (Thinking...)</span>');
}

function hideThinking(color) {
    $('.thinking').remove();
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