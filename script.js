var board = null;
var game = new Chess();
var $status = $('#status');
var $pgn = $('#pgn-display');
var sourceSquare = null;
var destinationSquare = null;
var moveSound = new Audio('sfx/move.ogg');
var checkSound = new Audio('sfx/check.ogg');

var gameMode = 'pvp';
var playerColor = 'white';
var aiDifficulty = 2;
moveSound.volume = 0.3;
checkSound.volume = 0.3;

// === AI ENGINE FUNCTIONS ===

var pieceValues = {
    'p': 100,
    'n': 320,
    'b': 330,
    'r': 500,
    'q': 900,
    'k': 20000
};

function evaluateBoard(game) {
    var totalEvaluation = 0;
    var board = game.board();
    
    for (var i = 0; i < 8; i++) {
        for (var j = 0; j < 8; j++) {
            var piece = board[i][j];
            if (piece) {
                var value = getPieceValue(piece, i, j);
                totalEvaluation += piece.color === 'w' ? value : -value;
            }
        }
    }
    
    return totalEvaluation;
}

// Get piece value with position bonus
function getPieceValue(piece, x, y) {
    var baseValue = pieceValues[piece.type] || 0;
    var positionBonus = getPositionBonus(piece.type, piece.color, x, y);
    return baseValue + positionBonus;
}

function getPositionBonus(pieceType, color, x, y) {
    // Adjust for black pieces (flip board)
    if (color === 'b') {
        x = 7 - x;
    }
    
    var bonus = 0;
    
    // Simplified bonuses for faster calculation
    // Pawns: encourage advancement
    if (pieceType === 'p') {
        bonus = x * 10; // Simple advancement bonus
        if (y >= 2 && y <= 5) bonus += 5; // Center files bonus
    }
    
    // Knights: prefer center
    if (pieceType === 'n') {
        var distFromCenter = Math.abs(3.5 - x) + Math.abs(3.5 - y);
        bonus = (7 - distFromCenter) * 5;
    }
    
    // Bishops: slight bonus for center
    if (pieceType === 'b') {
        var distFromCenter = Math.abs(3.5 - x) + Math.abs(3.5 - y);
        bonus = (7 - distFromCenter) * 2;
    }
    
    return bonus;
}

// Minimax algorithm with alpha-beta pruning
function minimax(game, depth, alpha, beta, isMaximizingPlayer) {
    if (depth === 0 || game.game_over()) {
        return evaluateBoard(game);
    }
    
    var moves = game.moves();
    
    // Move ordering: prioritize captures and checks for better pruning
    if (depth > 2) {
        moves = orderMoves(game, moves);
    }
    
    if (isMaximizingPlayer) {
        var maxEval = -Infinity;
        for (var i = 0; i < moves.length; i++) {
            game.move(moves[i]);
            var evaluation = minimax(game, depth - 1, alpha, beta, false);
            game.undo();
            maxEval = Math.max(maxEval, evaluation);
            alpha = Math.max(alpha, evaluation);
            if (beta <= alpha) break; // Beta cutoff
        }
        return maxEval;
    } else {
        var minEval = Infinity;
        for (var i = 0; i < moves.length; i++) {
            game.move(moves[i]);
            var evaluation = minimax(game, depth - 1, alpha, beta, true);
            game.undo();
            minEval = Math.min(minEval, evaluation);
            beta = Math.min(beta, evaluation);
            if (beta <= alpha) break; // Alpha cutoff
        }
        return minEval;
    }
}

// Order moves for better alpha-beta pruning
function orderMoves(game, moves) {
    var scoredMoves = [];
    
    for (var i = 0; i < moves.length; i++) {
        var move = game.move(moves[i]);
        var score = 0;
        
        // Prioritize captures
        if (move.captured) {
            score += pieceValues[move.captured] - pieceValues[move.piece] / 10;
        }
        
        // Prioritize checks
        if (game.in_check()) {
            score += 50;
        }
        
        game.undo();
        scoredMoves.push({ move: moves[i], score: score });
    }
    
    // Sort by score (highest first)
    scoredMoves.sort(function(a, b) { return b.score - a.score; });
    
    return scoredMoves.map(function(sm) { return sm.move; });
}

// Find best move for AI
function getBestMove(game, depth) {
    var moves = game.moves();
    var bestMove = null;
    var bestValue = -Infinity;
    var isWhite = game.turn() === 'w';
    
    // Shuffle moves for variety
    moves = shuffleArray(moves);
    
    for (var i = 0; i < moves.length; i++) {
        game.move(moves[i]);
        var boardValue = minimax(game, depth - 1, -Infinity, Infinity, !isWhite);
        game.undo();
        
        if (isWhite) {
            if (boardValue > bestValue) {
                bestValue = boardValue;
                bestMove = moves[i];
            }
        } else {
            boardValue = -boardValue; // Flip for black
            if (boardValue > bestValue) {
                bestValue = boardValue;
                bestMove = moves[i];
            }
        }
    }
    
    return bestMove;
}

// Shuffle array for move variety
function shuffleArray(array) {
    var newArray = array.slice();
    for (var i = newArray.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var temp = newArray[i];
        newArray[i] = newArray[j];
        newArray[j] = temp;
    }
    return newArray;
}

// Request move from AI engine
function getEngineMove() {
    if (engineThinking) return;
    
    engineThinking = true;
    showThinking(game.turn());
    
    // Use setTimeout to prevent UI freeze
    setTimeout(function() {
        var moveString = getBestMove(game, aiDifficulty);
        
        if (moveString) {
            // Parse move string
            var move = game.move(moveString);
            game.undo();
            
            if (move) {
                setTimeout(function() {
                    makeEngineMove(move.from, move.to, move.promotion || 'q');
                }, 200); // Reduced delay for faster response
            } else {
                console.error('Invalid move generated');
                engineThinking = false;
                hideThinking(game.turn());
            }
        } else {
            console.error('No move found');
            engineThinking = false;
            hideThinking(game.turn());
        }
    }, 50); // Reduced delay for faster start
}

// Execute engine move
function makeEngineMove(from, to, promotion) {
    var move = game.move({
        from: from,
        to: to,
        promotion: promotion
    });
    
    if (move) {
        board.position(game.fen(), true);
        if (!game.in_check()) {
            moveSound.currentTime = 0;
            moveSound.play().catch(e => console.log("Audio play failed:", e));
        }
        
        updateStatus();
        engineThinking = false;
        hideThinking(move.color);
        
        // Check if game is over
        if (!game.game_over()) {
            if (shouldEngineMove()) {
                setTimeout(getEngineMove, 500);
            }
        }
    } else {
        console.error('Invalid engine move:', from, to, promotion);
        engineThinking = false;
        hideThinking(game.turn());
    }
}

// Check if engine should move
function shouldEngineMove() {
    if (gameMode !== 'pve') return false;
    if (game.game_over()) return false;
    if (engineThinking) return false;
    
    var currentTurn = game.turn();
    var engineShouldMove = (playerColor === 'white' && currentTurn === 'b') ||
                          (playerColor === 'black' && currentTurn === 'w');
    
    return engineShouldMove;
}

// Show thinking indicator
function showThinking(color) {
    if (color === 'w') {
        $('#white-thinking').removeClass('hidden');
    } else {
        $('#black-thinking').removeClass('hidden');
    }
}

// Hide thinking indicator
function hideThinking(color) {
    if (color === 'w') {
        $('#white-thinking').addClass('hidden');
    } else {
        $('#black-thinking').addClass('hidden');
    }
}

// === BOARD INTERACTION FUNCTIONS ===

function removeHighlights() {
    $('#myBoard .square-55d63').removeClass('highlight-selected');
    $('#myBoard .square-55d63').css('background', '');
}

function highlightSquare(square) {
    var $square = $('#myBoard .square-' + square);
    $square.addClass('highlight-selected');
}

function greySquare(square) {
    var $square = $('#myBoard .square-' + square);
    var background = '#a9a9a9';
    if ($square.hasClass('black-3c85d')) {
        background = '#696969';
    }
    $square.css('background', background);
}

// Check if move is pawn promotion
function isPromotion(source, target) {
    var piece = game.get(source);
    if (piece && piece.type === 'p' && (target[1] == '8' || target[1] == '1')) {
        var tempGame = new Chess(game.fen());
        var move = tempGame.move({ from: source, to: target, promotion: 'q' });
        if (move) return true;
    }
    return false;
}

function executeMove(source, target, promoPiece = 'q') {
    var move = game.move({
        from: source,
        to: target,
        promotion: promoPiece
    });

    if (move === null) return 'snapback';

    board.position(game.fen(), false);
    if (!game.in_check()) {
        moveSound.currentTime = 0;
        moveSound.play().catch(e => console.log("Audio play failed:", e));
    }
    updateStatus();
    removeHighlights();
    sourceSquare = null;
    
    // Trigger engine move if needed
    if (shouldEngineMove()) {
        setTimeout(getEngineMove, 200); // Faster response after player move
    }
    
    return 'success';
}

function onDragStart(source, piece) {
    if (game.game_over()) return false;
    
    // PvE mode: prevent dragging opponent's pieces
    if (gameMode === 'pve') {
        var currentTurn = game.turn();
        if ((playerColor === 'white' && currentTurn === 'b') ||
            (playerColor === 'black' && currentTurn === 'w')) {
            return false;
        }
        if (engineThinking) return false;
    }
    
    if (sourceSquare) {
        if (isPromotion(sourceSquare, source)) {
            destinationSquare = source;
            $('#promotion-dialog').removeClass('hidden');
            return false;
        }
        
        var move = game.move({ from: sourceSquare, to: source, promotion: 'q' });
        if (move) {
            game.undo();
            executeMove(sourceSquare, source);
            return false;
        }
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

function onMouseoverSquare(square, piece) {
    var moves = game.moves({ square: square, verbose: true });
    if (moves.length === 0) return;

    for (var i = 0; i < moves.length; i++) {
        addHint(moves[i].to);
    }
}

function onMouseoutSquare(square, piece) {
    $('#myBoard .square-55d63').css('background', '');
    removeHints();
    if (sourceSquare) highlightSquare(sourceSquare);
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

function removeHints() {
    $('.hint-circle, .hint-ring').remove();
    $('#myBoard .square-55d63').removeClass('highlight-selected');
}

window.choosePromotion = function(pieceType) {
    $('#promotion-dialog').addClass('hidden');
    executeMove(sourceSquare, destinationSquare, pieceType);
}

// === UI UPDATE FUNCTIONS ===

function updateStatus() {
    var status = '';
    var moveColor = (game.turn() === 'b') ? 'Black' : 'White';

    if (game.in_checkmate()) {
        status = 'Game over, ' + moveColor + ' is in checkmate.';
    } else if (game.in_draw()) {
        status = 'Game over, drawn position';
    } else {
        status = moveColor + ' to move';
        if (game.in_check()) {
            status += ', ' + moveColor + ' is in check';
            checkSound.currentTime = 0;
            checkSound.play().catch(e => console.log("Audio play failed:", e));
        }
    }

    $status.html(status);
    $pgn.html(game.pgn({ max_width: 5, newline_char: '<br />' }));
    var pgnBox = document.getElementById("pgn-display");
    if (pgnBox) {
        pgnBox.scrollTop = pgnBox.scrollHeight;
    }
}

function updatePlayerNames() {
    if (gameMode === 'pvp') {
        $('#white-name').text('Player 1 (White)');
        $('#black-name').text('Player 2 (Black)');
        $('#player-white .player-avatar').text('👤');
        $('#player-black .player-avatar').text('👤');
        $('#game-mode-display').text('Mode: Player vs Player');
        $('#difficulty-display').text('');
    } else {
        var difficultyText = ['Easy', 'Medium', 'Hard', 'Expert'];
        if (playerColor === 'white') {
            $('#white-name').text('You (White)');
            $('#black-name').text('Computer (Black)');
            $('#player-white .player-avatar').text('👤');
            $('#player-black .player-avatar').text('🤖');
        } else {
            $('#white-name').text('Computer (White)');
            $('#black-name').text('You (Black)');
            $('#player-white .player-avatar').text('🤖');
            $('#player-black .player-avatar').text('👤');
        }
        $('#game-mode-display').text('Mode: Player vs Computer');
        $('#difficulty-display').text('Level: ' + difficultyText[aiDifficulty - 1]);
    }
}

function startNewGame() {
    game.reset();
    board.start();
    updateStatus();
    removeHighlights();
    sourceSquare = null;
    destinationSquare = null;
    engineThinking = false;
    hideThinking('w');
    hideThinking('b');
    
    // If engine plays white, make first move
    if (gameMode === 'pve' && playerColor === 'black' && !game.game_over()) {
        setTimeout(getEngineMove, 400); // Faster initial move
    }
}

// === INITIALIZATION ===

var config = {
    draggable: true,
    moveSpeed: 200,
    snapBackSpeed: 500,
    snapSpeed: 100,
    position: 'start',
    onDragStart: onDragStart,
    onDrop: onDrop,
    onMouseoverSquare: onMouseoverSquare,
    onMouseoutSquare: onMouseoutSquare,
    pieceTheme: 'https://lichess1.org/assets/piece/cburnett/{piece}.svg'
};

board = Chessboard('myBoard', config);

// === EVENT HANDLERS ===

// Mode selection
$('#btnPvP').on('click', function() {
    gameMode = 'pvp';
    playerColor = 'white';
    $('#mode-selection').addClass('hidden');
    $('#game-container').removeClass('hidden');
    updatePlayerNames();
    startNewGame();
});

$('#btnPvE').on('click', function() {
    gameMode = 'pve';
    $('#mode-selection').addClass('hidden');
    $('#color-selection').removeClass('hidden');
});

// Color selection
$('#btnWhite').on('click', function() {
    playerColor = 'white';
    startPvEGame();
});

$('#btnBlack').on('click', function() {
    playerColor = 'black';
    startPvEGame();
});

$('#btnRandom').on('click', function() {
    playerColor = Math.random() < 0.5 ? 'white' : 'black';
    startPvEGame();
});

function startPvEGame() {
    $('#color-selection').addClass('hidden');
    $('#game-container').removeClass('hidden');
    updatePlayerNames();
    startNewGame();
    
    if (playerColor === 'black') {
        board.flip();
    }
}

// Control buttons
$('#btnNewGame').on('click', function() {
        startNewGame();
});

$('#btnFlip').on('click', function() {
    board.flip();
});

$('#btnBackToMenu').on('click', function() {
        $('#game-container').addClass('hidden');
        $('#mode-selection').removeClass('hidden');
        game.reset();
        board.start();
        board.orientation('white');
        engineThinking = false;
        hideThinking('w');
        hideThinking('b');
});

// Initialize
$(document).ready(function() {
    updateStatus();
});



