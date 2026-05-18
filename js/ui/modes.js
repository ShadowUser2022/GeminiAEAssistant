/**
 * @file ui/modes.js
 * @description Mode switching (Agent / Ask / Draw), model dropdown management,
 *              Draw sub-mode (Scene / Isolated Asset), and Chroma Key color selector.
 *
 * Depends on: config.js     (TEXT_FREE_MODELS, TEXT_PAID_MODELS, IMAGE_FREE_MODELS,
 *                             IMAGE_PAID_MODELS, GEMINI_API_KEY)
 *             ui/console.js (logToConsole)
 *
 * Shared globals written: currentMode, googleBillingStatus, drawSubMode, activeChromaColor
 * Shared globals read:    attachedFiles (for clearing on Draw mode entry)
 */

// ─── Global UI State ──────────────────────────────────────────────────────────

/** @type {'execute'|'consult'|'draw'} Current active panel mode. */
var currentMode = 'execute';

/**
 * Google billing status — determines whether paid models are enabled.
 * @type {'unknown'|'checking'|'active'|'inactive'}
 */
var googleBillingStatus = 'unknown';

/** @type {'scene'|'element'} Draw sub-mode: general scene or isolated asset. */
var drawSubMode = 'scene';

/** @type {'green'|'magenta'|'blue'|'black'|'white'} Active chroma key colour. */
var activeChromaColor = 'green';

/** Cache of response card innerHTML and visibility status per mode. */
var modeResponses = {
    execute: { html: '', visible: false },
    consult: { html: '', visible: false },
    draw:    { html: '', visible: false }
};

// ─── Mode Button References ───────────────────────────────────────────────────

var modeBtns = {
    execute: document.getElementById('modeExecute'),
    consult: document.getElementById('modeConsult'),
    draw:    document.getElementById('modeDraw')
};

// ─── Model Dropdown ───────────────────────────────────────────────────────────

/**
 * Rebuilds the #modelSelect dropdown for the given mode.
 *
 * - In 'draw' mode: shows free image models + paid image models (locked if billing inactive).
 * - In 'execute'/'consult' modes: shows free text models + paid text models.
 * - While billing is being checked: shows a single disabled placeholder option.
 *
 * Restores the previously selected value if it still exists and is not disabled.
 *
 * @param {'execute'|'consult'|'draw'} mode
 */
function updateModelDropdown(mode) {
    var modelSelect = document.getElementById('modelSelect');
    if (!modelSelect) return;

    var previousValue = modelSelect.value;
    modelSelect.innerHTML = '';

    // Checking state — show placeholder
    if (googleBillingStatus === 'checking') {
        var opt      = document.createElement('option');
        opt.value    = '';
        opt.disabled = true;
        opt.selected = true;
        opt.textContent = '⏳ Checking model availability...';
        modelSelect.appendChild(opt);
        return;
    }

    var freeGroup  = document.createElement('optgroup');
    freeGroup.label = 'Free Tier';

    var paidGroup  = document.createElement('optgroup');
    paidGroup.label = 'Paid Tier (Requires Billing)';

    if (mode === 'draw') {
        // Free image models
        IMAGE_FREE_MODELS.forEach(function (model) {
            var opt      = document.createElement('option');
            opt.value    = model.id;
            opt.textContent = model.name;
            freeGroup.appendChild(opt);
        });

        // Paid image models
        IMAGE_PAID_MODELS.forEach(function (model) {
            var opt   = document.createElement('option');
            opt.value = model.id;
            if (googleBillingStatus === 'inactive') {
                opt.textContent = model.name + ' (Locked ⚠️)';
                opt.disabled    = true;
            } else {
                opt.textContent = model.name;
            }
            paidGroup.appendChild(opt);
        });

    } else {
        // Free text models
        TEXT_FREE_MODELS.forEach(function (model) {
            var opt      = document.createElement('option');
            opt.value    = model.id;
            opt.textContent = model.name;
            freeGroup.appendChild(opt);
        });

        // Paid text models
        TEXT_PAID_MODELS.forEach(function (model) {
            var opt   = document.createElement('option');
            opt.value = model.id;
            if (googleBillingStatus === 'inactive') {
                opt.textContent = model.name + ' (Locked ⚠️)';
                opt.disabled    = true;
            } else {
                opt.textContent = model.name;
            }
            paidGroup.appendChild(opt);
        });
    }

    modelSelect.appendChild(freeGroup);
    modelSelect.appendChild(paidGroup);

    // Restore previous selection if still valid
    var allOptions    = Array.from(modelSelect.querySelectorAll('option'));
    var prevStillValid = allOptions.find(function (o) { return o.value === previousValue && !o.disabled; });

    if (prevStillValid) {
        modelSelect.value = previousValue;
    } else {
        var firstEnabled = allOptions.find(function (o) { return !o.disabled; });
        if (firstEnabled) modelSelect.value = firstEnabled.value;
    }
}

// ─── Billing Status Check ─────────────────────────────────────────────────────

/**
 * Queries the Gemini models endpoint to verify that the API key has access.
 * Sets `googleBillingStatus` to 'active' on success, 'inactive' on failure.
 * Rebuilds the model dropdown after the check completes.
 *
 * Guards against concurrent calls with the 'checking' state.
 */
async function checkGoogleBillingStatus() {
    if (googleBillingStatus === 'checking') return;
    googleBillingStatus = 'checking';
    updateModelDropdown(currentMode);

    try {
        var url = 'https://generativelanguage.googleapis.com/v1beta/models?key=' + GEMINI_API_KEY;
        var res = await fetch(url);
        if (res.ok) {
            googleBillingStatus = 'active';
            logToConsole('Google API Key validated successfully. Paid models available.');
        } else {
            googleBillingStatus = 'inactive';
            logToConsole('Google API Key check: Billing/Quota limits detected. Paid models disabled.');
        }
    } catch (e) {
        googleBillingStatus = 'inactive';
        logToConsole('Google API Key check failed. Restricting to free models.');
    } finally {
        updateModelDropdown(currentMode);
    }
}

// ─── Mode Switcher ────────────────────────────────────────────────────────────

/**
 * Switches the panel to the given mode, updating button states, the model dropdown,
 * and showing/hiding UI elements specific to each mode.
 *
 * @param {'execute'|'consult'|'draw'} mode
 */
function switchMode(mode) {
    var responseCard = document.getElementById('responseCard');
    var genBtn       = document.getElementById('generateBtn');
    var attachBtn    = document.getElementById('attachBtn');

    // 1. Save current mode response before switching
    if (responseCard) {
        modeResponses[currentMode] = {
            html: responseCard.innerHTML,
            visible: !responseCard.classList.contains('hidden')
        };
    }

    currentMode = mode;

    modeBtns.execute.classList.toggle('active', mode === 'execute');
    modeBtns.consult.classList.toggle('active', mode === 'consult');
    modeBtns.draw.classList.toggle('active',    mode === 'draw');

    updateModelDropdown(mode);

    // 2. Restore saved response for the new mode
    var saved = modeResponses[mode];
    if (saved && saved.html) {
        responseCard.innerHTML = saved.html;
        if (saved.visible) {
            responseCard.classList.remove('hidden');
        } else {
            responseCard.classList.add('hidden');
        }
    } else {
        responseCard.innerHTML = '';
        responseCard.classList.add('hidden');
    }

    if (mode === 'execute') {
        genBtn.setAttribute('title', 'Generate & Run');
        document.getElementById('promptInput').placeholder = 'E.g.: Create composition "Intro", add a shape layer with a glowing red circle moving left to right...';
        attachBtn.style.display = 'flex';
        document.getElementById('drawOptions').classList.add('hidden');
        document.getElementById('chromaSelector').classList.add('hidden');

    } else if (mode === 'consult') {
        genBtn.setAttribute('title', 'Ask Gemini');
        document.getElementById('promptInput').placeholder = 'E.g.: Explain how to use the loopOut("cycle") expression, or write a plan for a transition script...';
        attachBtn.style.display = 'flex';
        document.getElementById('drawOptions').classList.add('hidden');
        document.getElementById('chromaSelector').classList.add('hidden');

    } else {
        // Draw mode
        genBtn.setAttribute('title', 'Generate Image');
        document.getElementById('promptInput').placeholder = 'Formula: [Style], [Subject], [Background], no humans.\nE.g.: 3D fluid art, rainbow puddle, dark background, no humans';
        attachBtn.style.display = 'none';
        attachedFiles = [];
        renderPreviews();
        document.getElementById('drawOptions').classList.remove('hidden');
        if (drawSubMode === 'element') {
            document.getElementById('chromaSelector').classList.remove('hidden');
        } else {
            document.getElementById('chromaSelector').classList.add('hidden');
        }
    }
}

// ─── Draw Sub-mode ────────────────────────────────────────────────────────────

document.getElementById('drawModeScene').addEventListener('click', function () {
    drawSubMode = 'scene';
    document.getElementById('drawModeScene').classList.add('active');
    document.getElementById('drawModeElement').classList.remove('active');
    document.getElementById('chromaSelector').classList.add('hidden');
});

document.getElementById('drawModeElement').addEventListener('click', function () {
    drawSubMode = 'element';
    document.getElementById('drawModeElement').classList.add('active');
    document.getElementById('drawModeScene').classList.remove('active');
    document.getElementById('chromaSelector').classList.remove('hidden');
});

// ─── Chroma Key Colour Selector ───────────────────────────────────────────────

/**
 * Click handler for chroma-key colour pill buttons.
 * Deactivates all pills, activates the clicked one, and updates `activeChromaColor`.
 */
document.querySelectorAll('.chroma-pill').forEach(function (pill) {
    pill.addEventListener('click', function (e) {
        document.querySelectorAll('.chroma-pill').forEach(function (p) {
            p.classList.remove('active');
        });
        var targetPill = e.target.closest('.chroma-pill');
        targetPill.classList.add('active');
        activeChromaColor = targetPill.getAttribute('data-color');
        logToConsole('Selected chroma key color: ' + activeChromaColor);
    });
});

// ─── Mode Button Listeners ────────────────────────────────────────────────────

modeBtns.execute.addEventListener('click', function () { switchMode('execute'); });
modeBtns.consult.addEventListener('click', function () { switchMode('consult'); });
modeBtns.draw.addEventListener('click',    function () { switchMode('draw');    });
