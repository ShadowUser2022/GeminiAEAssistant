/**
 * @file ae/bridge.js
 * @description CEP ↔ After Effects bridge layer.
 *
 * Handles all communication between the JavaScript panel and the
 * ExtendScript host (jsx/host.jsx) via CSInterface.evalScript.
 *
 * Depends on: config.js       (no direct dependency, uses global csInterface)
 *             ui/console.js   (logToConsole, setStatus)
 *
 * Shared globals read: csInterface (from main.js), currentMode (from ui/modes.js)
 */

// ─── Script Execution ─────────────────────────────────────────────────────────

/**
 * Base64-encodes the given ExtendScript code and sends it to After Effects
 * via the `evaluateAIGeneratedCode` function defined in jsx/host.jsx.
 *
 * On success: logs "Executed successfully." and resets the status bar.
 * On failure: logs the ExtendScript error with line number.
 *
 * @param {string} code - Raw ExtendScript (JSX) code to execute in AE.
 */
function executeInAE(code) {
    if (code) {
        // Auto-correct common effect MatchName hallucinations (e.g. ADBE Keylight -> Keylight (1.2))
        code = code.replace(/["']ADBE Keylight["']/g, '"Keylight (1.2)"');

        // Auto-correct Bevel Alpha hallucinated property matchNames to their correct indices
        code = code.replace(/\.property\(\s*["']ADBE Bevel Alpha-0001["']\s*\)/g, '.property(1)');
        code = code.replace(/\.property\(\s*["']ADBE Bevel Alpha-0002["']\s*\)/g, '.property(2)');
        code = code.replace(/\.property\(\s*["']ADBE Bevel Alpha-0003["']\s*\)/g, '.property(3)');
        code = code.replace(/\.property\(\s*["']ADBE Bevel Alpha-0004["']\s*\)/g, '.property(4)');
        code = code.replace(/\.property\(\s*["']ADBE Bevel Alpha-0005["']\s*\)/g, 'null');

        // Auto-correct 4-element color arrays [R, G, B, A] to 3-element [R, G, B] inside .setValue()
        // This prevents the "Color Array does not have 3 values" error in After Effects.
        code = code.replace(/\.setValue\(\s*\[\s*([^,\s\]]+)\s*,\s*([^,\s\]]+)\s*,\s*([^,\s\]]+)\s*,\s*([^,\s\]]+)\s*\]\s*\)/g, '.setValue([$1, $2, $3])');

        // Wrap in Immediately Invoked Function Expression (IIFE) to support early returns and protect global scope
        code = '(function(){\n' + code + '\n})();';
    }

    var encodedCode = btoa(unescape(encodeURIComponent(code)));

    csInterface.evalScript('evaluateAIGeneratedCode("' + encodedCode + '")', function (result) {
        try {
            var parsedResult = JSON.parse(result);
            if (parsedResult.success) {
                logToConsole('Executed successfully.');
                setStatus('Ready.', false);
                // Send push notification to Telegram if enabled
                if (typeof sendTelegramMessage === 'function' && telegramEnabled && telegramToken) {
                    sendTelegramMessage("⚡️ *Скрипт успешно выполнен!*\nExtendScript-код сгенерирован и успешно применен к таймлайну After Effects на вашем компьютере.");
                }
            } else {
                logToConsole('ExtendScript Error:\n' + parsedResult.error);
                setStatus('Execution error.', false);
            }
        } catch (e) {
            logToConsole('Raw Eval Result: ' + result);
            setStatus('Ready.', false);
        }
    });
}

// ─── Persistent Session Log ───────────────────────────────────────────────────

/**
 * Automatically purges daily log files older than 7 days from the logs directory.
 *
 * @param {string} logsDir - Absolute path to the logs folder.
 */
function cleanupOldLogs(logsDir) {
    try {
        var readdirResult = window.cep.fs.readdir(logsDir);
        if (readdirResult.err === 0 && readdirResult.data) {
            var files = readdirResult.data;
            var now = new Date();
            var limitMs = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds

            for (var i = 0; i < files.length; i++) {
                var file = files[i];
                var match = file.match(/^Gemini_AE_History_(\d{4})_(\d{2})_(\d{2})\.txt$/);
                if (match) {
                    var fileDate = new Date(
                        parseInt(match[1], 10),
                        parseInt(match[2], 10) - 1,
                        parseInt(match[3], 10)
                    );
                    if (now - fileDate > limitMs) {
                        var oldFilePath = logsDir + '/' + file;
                        window.cep.fs.deleteFile(oldFilePath);
                        logToConsole('Auto-deleted logs older than 7 days: ' + file);
                    }
                }
            }
        }
    } catch (e) {
        console.error('Auto-cleanup of old logs failed', e);
    }
}

/**
 * Appends a session entry to a daily log file `logs/Gemini_AE_History_YYYY_MM_DD.txt`.
 * Automatically deletes daily log files older than 7 days.
 *
 * Each entry records the timestamp, mode, selected model, status, prompt, and response.
 *
 * @param {string} prompt   - The user's original prompt text.
 * @param {string} response - The model's response (code or text).
 * @param {string} status   - One of: 'SUCCESS (AGENT)', 'CONSULT', 'API_ERROR'.
 */
function saveToPersistentLog(prompt, response, status) {
    try {
        var nowObj = new Date();
        var time  = nowObj.toLocaleString();
        var model = document.getElementById('modelSelect').value;
        var logEntry = '\n--- [' + time + '] ---\n' +
            'MODE: '     + currentMode + '\n' +
            'MODEL: '    + model       + '\n' +
            'STATUS: '   + status      + '\n' +
            'PROMPT: '   + prompt      + '\n' +
            'RESPONSE:\n' + response   + '\n' +
            '------------------\n';

        var extensionDir = csInterface.getSystemPath(SystemPath.EXTENSION);
        var logsDir = extensionDir + '/logs';
        window.cep.fs.makedir(logsDir);

        // Daily file name: Gemini_AE_History_YYYY_MM_DD.txt
        var yyyy = nowObj.getFullYear();
        var mm   = String(nowObj.getMonth() + 1).padStart(2, '0');
        var dd   = String(nowObj.getDate()).padStart(2, '0');
        var path = logsDir + '/Gemini_AE_History_' + yyyy + '_' + mm + '_' + dd + '.txt';

        // Read existing content (append-mode emulation via CEP fs API)
        var result          = window.cep.fs.readFile(path);
        var existingContent = (result.err === 0) ? result.data : '';

        // 1. Save to cumulative history log
        window.cep.fs.writeFile(path, existingContent + logEntry);
        logToConsole('History saved to: ' + path);

        // 2. Save standalone Gemini_AE_Last_Prompt.txt for easy debug copy/pasting
        var debugPath = logsDir + '/Gemini_AE_Last_Prompt.txt';
        var debugContent = '=== LAST PROMPT ===\n' + prompt + '\n\n' +
            '=== METADATA ===\n' +
            'Time: ' + time + '\n' +
            'Mode: ' + currentMode + '\n' +
            'Model: ' + model + '\n' +
            'Status: ' + status + '\n\n' +
            '=== LAST RESPONSE ===\n' + response + '\n';
        window.cep.fs.writeFile(debugPath, debugContent);
        logToConsole('Last prompt saved to: ' + debugPath);

        // 3. Save raw generated ExtendScript to Gemini_AE_Last_Code.jsx for direct execution
        if (status === 'SUCCESS (AGENT)') {
            var codePath = logsDir + '/Gemini_AE_Last_Code.jsx';
            window.cep.fs.writeFile(codePath, response);
            logToConsole('Last JSX code saved to: ' + codePath);
        }

        // 4. Automatically purge daily logs older than 7 days
        cleanupOldLogs(logsDir);
    } catch (e) {
        console.error('Logging failed', e);
    }
}
