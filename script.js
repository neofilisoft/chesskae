var board = null;
var game = new Chess();
var $status = $('#status');
var $pgn = $('#pgn-display');
var sourceSquare = null;
var destinationSquare = null;

function removeHighlights () {
  $('#myBoard .square-55d63').removeClass('highlight-selected');
  $('#myBoard .square-55d63').css('background', '');
}

function highlightSquare (square) {
  var $square = $('#myBoard .square-' + square);
  $square.addClass('highlight-selected');
}

function greySquare (square) {
  var $square = $('#myBoard .square-' + square);
  var background = '#a9a9a9';
  if ($square.hasClass('black-3c85d')) {
    background = '#696969';
  }
  $square.css('background', background);
}
// เช็คว่าเป็นเบี้ยเข้าฮอส
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
    updateStatus();
    removeHighlights();
    sourceSquare = null;
    return 'success';
}

function onDragStart (source, piece) {
  if (game.game_over()) return false;
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

function onDrop (source, target) {
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

function onMouseoverSquare (square, piece) {
  var moves = game.moves({ square: square, verbose: true });
  if (moves.length === 0) return;

  for (var i = 0; i < moves.length; i++) {
    addHint(moves[i].to);
  }
}
function onMouseoutSquare (square, piece) {
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

// UI Updates
function updateStatus () {
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
    }
  }

  $status.html(status);
  $pgn.html(game.pgn({ max_width: 5, newline_char: '<br />' }));
  var pgnBox = document.getElementById("pgn-display");
  pgnBox.scrollTop = pgnBox.scrollHeight;
}

// Initial
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
updateStatus();

$('#btnNewGame').on('click', function() {
    game.reset();
    board.start();
    updateStatus();
    removeHighlights();
    sourceSquare = null;
    destinationSquare = null;
});
$('#btnFlip').on('click', board.flip);