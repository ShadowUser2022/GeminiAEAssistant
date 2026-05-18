/**
 * @file ui/renderer.js
 * @description Markdown-to-HTML renderer and clipboard utilities.
 *
 * Depends on: ui/console.js  (logToConsole)
 *
 * Registers a delegated click handler on #responseCard to handle
 * "Copy" buttons inside code blocks.
 */

// ─── Clipboard Helper ─────────────────────────────────────────────────────────

/**
 * Copies the given text to the system clipboard.
 * Uses the modern Clipboard API where available, with a textarea fallback
 * for older Chromium engines or macOS sandboxed environments.
 *
 * @param  {string} text - Text to copy.
 * @returns {Promise<void>}
 */
function copyTextToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(text).catch(function (err) {
            console.warn("navigator.clipboard.writeText failed, trying fallback: ", err);
            return fallbackCopy(text);
        });
    }
    return fallbackCopy(text);
}

/**
 * Fallback clipboard write method using Node.js pbcopy (on macOS)
 * or creating a temporary textarea.
 *
 * @param {string} text
 * @returns {Promise<void>}
 */
function fallbackCopy(text) {
    // 1. Try Node.js child_process pbcopy for macOS
    try {
        if (typeof require !== 'undefined') {
            var cp = require('child_process');
            if (cp && cp.spawn) {
                var proc = cp.spawn('pbcopy');
                proc.stdin.write(text);
                proc.stdin.end();
                return Promise.resolve();
            }
        }
    } catch (nodeErr) {
        console.warn("Node.js pbcopy failed, trying textarea fallback: ", nodeErr);
    }

    // 2. Browser execCommand fallback
    return new Promise(function (resolve, reject) {
        try {
            var textArea = document.createElement('textarea');
            textArea.value = text;
            textArea.style.top      = '0';
            textArea.style.left     = '0';
            textArea.style.position = 'fixed';
            textArea.style.opacity  = '0';
            document.body.appendChild(textArea);
            textArea.focus();
            textArea.select();
            var successful = document.execCommand('copy');
            document.body.removeChild(textArea);
            if (successful) {
                resolve();
            } else {
                reject(new Error('execCommand copy returned false'));
            }
        } catch (err) {
            reject(err);
        }
    });
}

// ─── Markdown Renderer ────────────────────────────────────────────────────────

/**
 * Converts a subset of Markdown to HTML safe for display inside #responseCard.
 *
 * Supported syntax:
 *  - Fenced code blocks: ```[lang]\n...\n``` → <div class="code-block-container">
 *  - Inline code: `code` → <code>
 *  - Bold: **text** → <strong>
 *  - Bullet lists: * item / - item → <ul><li>
 *  - Plain text lines → <p>
 *
 * Code blocks receive a floating "Copy" button with the code encoded in base64
 * so the delegated click handler in this file can decode and copy it.
 *
 * @param  {string} text - Raw Markdown text from the API.
 * @returns {string} HTML string.
 */
function formatMarkdown(text) {
    if (!text) return '';

    // 1. Escape HTML entities to prevent injection
    var html = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    // 2. Fenced code blocks → styled container with Copy button
    html = html.replace(/```(?:javascript|js|extendscript|jsx)?\s*([\s\S]*?)```/gi, function (match, code) {
        var trimmedCode = code.trim();
        var base64Code  = btoa(unescape(encodeURIComponent(trimmedCode)));
        return '<div class="code-block-container">\n' +
            '<button class="copy-code-btn" data-code="' + base64Code + '">' +
            '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
            'stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:4px;">' +
            '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>' +
            '<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>' +
            '</svg>Copy</button>\n' +
            '<pre><code>' + trimmedCode + '</code></pre>\n' +
            '</div>';
    });

    // 3. Inline code
    html = html.replace(/`([^`\n]+)`/g, '<code>$1</code>');

    // 4. Bold
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

    // 5. Process line-by-line: bullet lists and paragraphs
    var lines         = html.split('\n');
    var inList        = false;
    var processedLines = [];

    for (var i = 0; i < lines.length; i++) {
        var line    = lines[i];
        var trimmed = line.trim();

        if (!trimmed) {
            if (inList) {
                processedLines.push('</ul>');
                inList = false;
            }
            continue;
        }

        // Pass through pre/code/container tags unchanged without wrapping them in <p>
        if (trimmed.indexOf('<pre>') === 0 || trimmed.indexOf('</pre>') === 0 ||
            trimmed.indexOf('<code>') === 0 || trimmed.indexOf('</code>') === 0 ||
            trimmed.indexOf('<div class="code-block-container">') === 0 ||
            trimmed.indexOf('</div>') === 0 ||
            trimmed.indexOf('<button class="copy-code-btn"') === 0) {
            if (inList) { processedLines.push('</ul>'); inList = false; }
            processedLines.push(line);
            continue;
        }

        // Bullet list item
        var listMatch = line.match(/^(\s*)[*-]\s+(.+)$/);
        if (listMatch) {
            if (!inList) { processedLines.push('<ul>'); inList = true; }
            processedLines.push('<li>' + listMatch[2] + '</li>');
        } else {
            if (inList) { processedLines.push('</ul>'); inList = false; }

            // Detect if we are currently inside a <pre> block
            var preOpenCount  = 0;
            var preCloseCount = 0;
            for (var k = 0; k < processedLines.length; k++) {
                var m1 = processedLines[k].match(/<pre>/g);
                var m2 = processedLines[k].match(/<\/pre>/g);
                if (m1) preOpenCount  += m1.length;
                if (m2) preCloseCount += m2.length;
            }
            var withinPre = preOpenCount > preCloseCount;

            if (withinPre) {
                processedLines.push(line);
            } else {
                processedLines.push('<p>' + line + '</p>');
            }
        }
    }

    if (inList) processedLines.push('</ul>');
    return processedLines.join('\n');
}

// ─── Delegated Copy Button Handler ───────────────────────────────────────────

/**
 * Listens for clicks on dynamically generated "Copy" buttons inside #responseCard.
 * Uses event delegation so it works for buttons added after page load.
 */
document.getElementById('responseCard').addEventListener('click', function (e) {
    var btn = e.target.closest('.copy-code-btn');
    if (!btn) return;

    var encodedData = btn.getAttribute('data-code');
    if (!encodedData) return;

    try {
        var decodedCode = decodeURIComponent(escape(atob(encodedData)));
        copyTextToClipboard(decodedCode).then(function () {
            var originalHTML = btn.innerHTML;
            btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#2ecc71" ' +
                'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ' +
                'style="vertical-align:middle;margin-right:4px;"><polyline points="20 6 9 17 4 12"></polyline></svg>Copied!';
            btn.style.borderColor = 'rgba(46,204,113,0.4)';
            btn.style.color       = '#2ecc71';
            setTimeout(function () {
                btn.innerHTML   = originalHTML;
                btn.style.borderColor = '';
                btn.style.color       = '';
            }, 2000);
        }).catch(function (err) {
            logToConsole('Clipboard error: ' + err.message);
        });
    } catch (err) {
        logToConsole('Code decoding error: ' + err.message);
    }
});
