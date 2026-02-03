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

moveSound.volume = 0.3;
checkSound.volume = 0.3;
checkmateSound.volume = 0.3;

// --- Server ---
// const SERVER_URL = "https://your-server-url";
const socket = io(SERVER_URL);

// === SOCKET LISTENERS ===
socket.on('roomCreated', function(code) {
    currentRoom = code;
    $('#create-room').addClass('hidden');
    $('#room-code').removeClass('hidden');
    $('#room-code-display').text(code);
});

socket.on('startGame', function(data) {
    currentRoom = data.roomCode;
    $('.modal-overlay').addClass('hidden');
    $('#game-container').removeClass('hidden');
    gameMode = 'online';
    if (!isHost) {
        myColor = data.hostColor === 'white' ? 'black' : 'white';
        playerColor = myColor;
    } else {
        playerColor = myColor;
    }
    updatePlayerNames();
    startNewGame();
    if (myColor === 'black') board.flip();
});

socket.on('moveMade', function(move) {
    game.move(move);
    board.position(game.fen());
    updateStatus();
    if (game.in_checkmate()) checkmateSound.play().catch(e=>{});
    else moveSound.play().catch(e=>{});
});

socket.on('error', function(msg) { alert(msg); });

// === CORE LOGIC ===
function onDragStart (source, piece) {
    if (game.game_over()) return false;
    if (gameMode === 'online') {
        if (game.turn() !== myColor[0]) return false;
    }
}

function onDrop(source, target) {
    var move = game.move({ from: source, to: target, promotion: 'q' });
    if (move === null) return 'snapback';

    if (gameMode === 'online' && currentRoom) {
        socket.emit('makeMove', { code: currentRoom, move: move });
    }
    board.position(game.fen());
    updateStatus();
    moveSound.play().catch(e=>{});

    if (gameMode === 'pve' && !game.game_over()) {
        setTimeout(makeBestMove, 250);
    }
}

function updateStatus() {
    var status = game.turn() === 'w' ? 'White to move' : 'Black to move';
    if (game.in_checkmate()) status = 'Checkmate!';
    $status.text(status);
}

function startNewGame() {
    game.reset();
    board.start();
    board.orientation(playerColor);
    updateStatus();
}

function updatePlayerNames() {
    $('#bottom-player-name').text(gameMode === 'online' ? 'You (' + myColor + ')' : 'You');
    $('#top-player-name').text(gameMode === 'pve' ? 'AI' : 'Opponent');
}

$(document).on('click', '#btnPvP', function() {
    gameMode = 'pvp';
    $('.modal-overlay').addClass('hidden');
    $('#game-container').removeClass('hidden');
    startNewGame();
});

$(document).on('click', '#btnOnline', function() {
    $('#mode-selection').addClass('hidden');
    $('#online-menu').removeClass('hidden');
});

$(document).on('click', '#btnCreateRoom', function() {
    $('#online-menu').addClass('hidden');
    $('#create-room').removeClass('hidden');
});

$(document).on('click', '.color-btn', function() {
    var color = $(this).attr('data-color');
    if ($('#create-room').is(':visible')) {
        isHost = true;
        myColor = color;
        socket.emit('createRoom', { color: color });
    } else {
        playerColor = color;
        gameMode = 'pve';
        $('.modal-overlay').addClass('hidden');
        $('#game-container').removeClass('hidden');
        startNewGame();
    }
});

$(document).on('click', '#btnJoinRoom', function() {
    $('#online-menu').addClass('hidden');
    $('#join-room').removeClass('hidden');
});

$(document).on('click', '#btnJoinConfirm', function() {
    var code = $('#room-input').val().toUpperCase().trim();
    if (code) socket.emit('joinRoom', code);
});

$(document).on('click', '#btnBackToMenu', function() {
    location.reload();
});

// AI Logic
function makeBestMove() {
    var moves = game.moves();
    if (moves.length > 0) {
        game.move(moves[Math.floor(Math.random() * moves.length)]);
        board.position(game.fen());
        updateStatus();
        moveSound.play().catch(e=>{});
    }
}

board = Chessboard('myBoard', {
    draggable: true,
    position: 'start',
    onDragStart: onDragStart,
    onDrop: onDrop
});
