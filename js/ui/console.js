/**
 * @file ui/console.js
 * @description Developer console, status bar, and context window tracker.
 *
 * Depends on: config.js  (CONTEXT_MAX_CHARS, IMAGE_CONTEXT_WEIGHT)
 * Shared globals read: chatHistory
 */

// ─── Developer Console ────────────────────────────────────────────────────────

/**
 * Appends a timestamped message to the developer console textarea.
 *
 * @param {string} msg - The message to display.
 */
function logToConsole(msg) {
    var consoleEl = document.getElementById('consoleOutput');
    var time = new Date().toLocaleTimeString();
    consoleEl.value += '[' + time + '] ' + msg + '\n';
    consoleEl.scrollTop = consoleEl.scrollHeight;
}

// ─── Status Bar ───────────────────────────────────────────────────────────────

/**
 * Updates the status text shown below the response card.
 *
 * @param {string}  msg       - Text to display.
 * @param {boolean} isLoading - When true, text is shown in orange (active state).
 */
function setStatus(msg, isLoading) {
    var statusEl = document.getElementById('statusText');
    statusEl.innerText = msg;
    statusEl.style.color = isLoading ? '#f39c12' : '#aaa';
}

// ─── Context Window Tracker ───────────────────────────────────────────────────

/**
 * Recalculates the approximate context usage and updates the circular SVG ring.
 *
 * Counts text characters and assigns IMAGE_CONTEXT_WEIGHT per attached image
 * to estimate total token pressure. Colours the ring:
 *  - purple  (normal)  < 50 %
 *  - orange  (warning) 50 – 79 %
 *  - red     (danger)  ≥ 80 %  (also shows "New Task" label)
 *
 * Reads the global `chatHistory` array (defined in main.js).
 */
function updateContextTracker() {
    var ring    = document.getElementById('contextRing');
    var warning = document.getElementById('contextWarning');
    if (!ring) return;

    var totalChars = 0;
    for (var i = 0; i < chatHistory.length; i++) {
        var item = chatHistory[i];
        if (!item.parts) continue;
        for (var j = 0; j < item.parts.length; j++) {
            var part = item.parts[j];
            if (part.text) {
                totalChars += part.text.length;
            } else if (part.inlineData) {
                totalChars += IMAGE_CONTEXT_WEIGHT;
            }
        }
    }

    var percentage = Math.min(Math.round((totalChars / CONTEXT_MAX_CHARS) * 100), 100);
    ring.setAttribute('stroke-dasharray', percentage + ', 100');

    ring.classList.remove('normal', 'warning', 'danger');
    if (percentage < 50) {
        ring.classList.add('normal');
        warning.classList.add('hidden');
    } else if (percentage < 80) {
        ring.classList.add('warning');
        warning.classList.add('hidden');
    } else {
        ring.classList.add('danger');
        warning.classList.remove('hidden');
    }
}

// ─── API Keys Settings & Cost Tracking Management ──────────────────────────────

var MODEL_PRICING = {
    // Gemini 2.5 Flash
    'gemini-2.5-flash': { input: 0.075 / 1000000, output: 0.30 / 1000000 },
    // Gemini 2.5 Flash Lite
    'gemini-2.5-flash-lite': { input: 0.0375 / 1000000, output: 0.15 / 1000000 },
    // Gemini 2.5 Pro / Gemini 3.1 Pro Preview
    'gemini-2.5-pro': { input: 1.25 / 1000000, output: 5.00 / 1000000 },
    'gemini-3.1-pro-preview': { input: 1.25 / 1000000, output: 5.00 / 1000000 },
    
    // Google Imagen & Multimodal Image Gen
    'imagen-4.0-generate-001': { flat: 0.03 },
    'imagen-3.0-generate-001': { flat: 0.03 },
    'gemini-3-pro-image-preview': { flat: 0.03 },
    'gemini-3.1-flash-image-preview': { flat: 0.005 },
    'gemini-2.5-flash-image': { flat: 0.003 }
};

/**
 * Updates the session cost tracker based on token usage or image count.
 * Calculates cost using standard pricing and saves persistently to localStorage.
 *
 * @param {string} modelId        - Active model identifier.
 * @param {number} [promptTokens=0] - Number of input/prompt tokens.
 * @param {number} [candidatesTokens=0] - Number of output/response tokens.
 * @param {number} [imageCount=0]   - Number of generated images.
 */
function updateSessionCost(modelId, promptTokens, candidatesTokens, imageCount) {
    promptTokens = promptTokens || 0;
    candidatesTokens = candidatesTokens || 0;
    imageCount = imageCount || 0;

    var currentCost = parseFloat(localStorage.getItem('gemini_ae_session_cost')) || 0.0;
    var addedCost = 0.0;

    if (imageCount > 0) {
        if (modelId && (modelId.indexOf('pollinations') !== -1 || modelId.indexOf('flux') !== -1)) {
            addedCost = 0.0; // Pollinations FLUX is free!
        } else {
            // Google Imagen is $0.03 flat per image
            addedCost = 0.03 * imageCount;
        }
    } else if (modelId) {
        var pricing = null;
        for (var key in MODEL_PRICING) {
            if (modelId.indexOf(key) !== -1) {
                pricing = MODEL_PRICING[key];
                break;
            }
        }
        if (!pricing) {
            pricing = MODEL_PRICING['gemini-2.5-flash']; // fallback to flash
        }
        addedCost = (promptTokens * pricing.input) + (candidatesTokens * pricing.output);
    }

    currentCost += addedCost;
    localStorage.setItem('gemini_ae_session_cost', currentCost.toFixed(5));
    
    var costDisplay = document.getElementById('costDisplay');
    if (costDisplay) {
        costDisplay.textContent = 'Est. Cost: $' + currentCost.toFixed(3);
        costDisplay.title = 'Total Cost: $' + currentCost.toFixed(5) + 
                           '\nLast call: ' + 
                           (imageCount > 0 ? (imageCount + ' image(s)') : (promptTokens + ' in / ' + candidatesTokens + ' out tokens'));
    }
}

/**
 * Initializes the API Keys entry UI and the Session Cost tracker inside the Developer Console.
 */
function initApiKeysSettings() {
    var geminiInput = document.getElementById('geminiKeyInput');
    var imagenInput = document.getElementById('imagenKeyInput');
    var toggleGemini = document.getElementById('toggleGeminiKey');
    var toggleImagen = document.getElementById('toggleImagenKey');
    var costDisplay = document.getElementById('costDisplay');
    var resetCostBtn = document.getElementById('resetCostBtn');

    if (!geminiInput || !imagenInput) return;

    // Load initial values (default to empty if none in localStorage)
    geminiInput.value = localStorage.getItem('gemini_api_key') || '';
    imagenInput.value = localStorage.getItem('imagen_api_key') || '';

    // Typing listener for Gemini Key
    geminiInput.addEventListener('input', function () {
        var val = geminiInput.value.trim();
        if (val) {
            localStorage.setItem('gemini_api_key', val);
            GEMINI_API_KEY = val;
        } else {
            localStorage.removeItem('gemini_api_key');
            GEMINI_API_KEY = ''; // fallback
        }
        if (typeof checkGoogleBillingStatus === 'function') {
            checkGoogleBillingStatus();
        }
    });

    // Typing listener for Imagen Key
    imagenInput.addEventListener('input', function () {
        var val = imagenInput.value.trim();
        if (val) {
            localStorage.setItem('imagen_api_key', val);
            IMAGEN_API_KEY = val;
        } else {
            localStorage.removeItem('imagen_api_key');
            IMAGEN_API_KEY = ''; // fallback
        }
        if (typeof resolveAvailableImageModels === 'function' && typeof currentMode !== 'undefined' && currentMode === 'draw') {
            resolveAvailableImageModels();
        }
    });

    // Helper to toggle visibility
    function toggleVisibility(inputEl, btnEl) {
        var isPassword = inputEl.type === 'password';
        inputEl.type = isPassword ? 'text' : 'password';
        if (isPassword) {
            btnEl.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>';
        } else {
            btnEl.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>';
        }
    }

    if (toggleGemini) {
        toggleGemini.addEventListener('click', function () {
            toggleVisibility(geminiInput, toggleGemini);
        });
    }

    if (toggleImagen) {
        toggleImagen.addEventListener('click', function () {
            toggleVisibility(imagenInput, toggleImagen);
        });
    }

    // Refresh cost display initially
    function refreshCostDisplay() {
        if (costDisplay) {
            var currentCost = parseFloat(localStorage.getItem('gemini_ae_session_cost')) || 0.0;
            costDisplay.textContent = 'Est. Cost: $' + currentCost.toFixed(3);
            costDisplay.title = 'Total Session Cost: $' + currentCost.toFixed(5) + '\nClick Reset to clear.';
        }
    }

    refreshCostDisplay();

    // Bind Cost Tracker Reset button
    if (resetCostBtn) {
        resetCostBtn.addEventListener('click', function () {
            var proceed = confirm("Вы действительно хотите сбросить счетчик расходов?");
            if (proceed) {
                localStorage.setItem('gemini_ae_session_cost', '0.00000');
                refreshCostDisplay();
                logToConsole('Session cost tracker reset to $0.000');
            }
        });
    }
}
