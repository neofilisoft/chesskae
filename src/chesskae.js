/*
 * Chesskae AI adapter.
 *
 * Stockfish is intentionally not hardcoded here. A deployment can provide a
 * UCI-compatible worker URL with window.CHESSKAE_ENGINE_CONFIG, for example:
 *
 *   window.CHESSKAE_ENGINE_CONFIG = {
 *     stockfishWorkerUrl: '/engine/stockfish.js'
 *   };
 *
 * Without that optional worker, the caller can fall back to its bundled search.
 */
(function (root) {
    'use strict';

    var worker = null;
    var ready = false;
    var pending = null;
    var config = root.CHESSKAE_ENGINE_CONFIG || {};

    function canUseWorker() {
        return typeof root.Worker === 'function' && typeof config.stockfishWorkerUrl === 'string' && config.stockfishWorkerUrl.trim();
    }

    function send(command) {
        if (worker) worker.postMessage(command);
    }

    function ensureWorker() {
        if (worker || !canUseWorker()) return !!worker;
        try {
            worker = new root.Worker(config.stockfishWorkerUrl);
            worker.onmessage = function (event) {
                var line = typeof event.data === 'string' ? event.data : '';
                if (line === 'uciok') {
                    send('isready');
                } else if (line === 'readyok') {
                    ready = true;
                } else if (pending && line.indexOf('bestmove ') === 0) {
                    var move = line.split(/\s+/)[1];
                    var resolve = pending.resolve;
                    pending = null;
                    resolve(move && move !== '(none)' ? move : null);
                }
            };
            worker.onerror = function () {
                ready = false;
                if (pending) {
                    pending.resolve(null);
                    pending = null;
                }
            };
            send('uci');
            return true;
        } catch (error) {
            worker = null;
            return false;
        }
    }

    function findBestMove(options) {
        options = options || {};
        if (!ensureWorker() || !options.fen || pending) return Promise.resolve(null);
        if (!ready) {
            return new Promise(function (resolve) {
                var attempts = 0;
                var waitForReady = function () {
                    if (ready) return findBestMove(options).then(resolve);
                    if (++attempts > 50) return resolve(null);
                    setTimeout(waitForReady, 100);
                };
                waitForReady();
            });
        }

        return new Promise(function (resolve) {
            pending = { resolve: resolve };
            var waitMs = Math.max(1000, Number(options.timeoutMs) || 5000);
            var timer = setTimeout(function () {
                if (!pending) return;
                pending = null;
                resolve(null);
            }, waitMs);
            var originalResolve = pending.resolve;
            pending.resolve = function (move) {
                clearTimeout(timer);
                originalResolve(move);
            };

            var depth = Number(options.depth);
            var movetime = Number(options.movetime);
            send('position fen ' + options.fen);
            send(depth > 0 ? 'go depth ' + depth : 'go movetime ' + Math.max(50, movetime || 500));
        });
    }

    root.ChesskaeAI = {
        isAvailable: canUseWorker,
        isReady: function () { return ready; },
        findBestMove: findBestMove,
        stop: function () { send('stop'); }
    };
}(window));
