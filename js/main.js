/**
 * @file main.js
 * @description Application orchestrator, event hub, and main generation handler.
 *
 * Implements the core generation routing (handleGenerate) and binds all UI events.
 *
 * Depends on: config.js, ui/console.js, ui/renderer.js, ui/attachments.js,
 *             ui/modes.js, ui/selectionContext.js, ae/bridge.js, api/gemini.js,
 *             api/imageGen.js
 */

// ─── Global App Variables ────────────────────────────────────────────────────
var csInterface          = new CSInterface();
var chatHistory          = [];
var attachedFiles        = [];
var attachedContextItems = [];
var isGenerating         = false;
var activeAbortController = null;

// ─── Startup Initialization ──────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function () {
    logToConsole('Gemini AE Assistant initializing...');

    // 1. Initialize settings & cost trackers
    initApiKeysSettings();

    // Initialize Telegram Remote Bot if configured
    if (typeof initTelegramBot === 'function') {
        initTelegramBot();
    }

    // 2. Query dynamicPaid billing capabilities
    checkGoogleBillingStatus();

    // 3. Initiate JSX Cache Hot-Reloading
    initHostJsxHotReload();

    // 4. Show startup session notification
    showToast('Начата новая сессия чата');

    // 4. Setup Key/UI Submit bindings
    var promptInput = document.getElementById('promptInput');
    var generateBtn = document.getElementById('generateBtn');
    var injectBtn   = document.getElementById('injectContextBtn');

    if (promptInput) {
        promptInput.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleGenerate();
            }
        });
    }

    if (generateBtn) {
        generateBtn.addEventListener('click', handleGenerate);
    }

    if (injectBtn) {
        injectBtn.addEventListener('click', injectSelectionContext);
    }

    // Toggle Logs Sliding Drawer Panel
    var toggleConsoleBtn = document.getElementById('toggleConsole');
    var consoleContainer = document.getElementById('consoleContainer');
    var closeConsoleBtn = document.getElementById('closeConsoleBtn');

    if (toggleConsoleBtn && consoleContainer) {
        toggleConsoleBtn.addEventListener('click', function () {
            consoleContainer.classList.toggle('collapsed');
        });
    }

    if (closeConsoleBtn && consoleContainer) {
        closeConsoleBtn.addEventListener('click', function () {
            consoleContainer.classList.add('collapsed');
        });
    }

    // Toggle Help Panel
    var toggleHelpBtn = document.getElementById('toggleHelp');
    var helpBanner = document.getElementById('helpBanner');
    var closeHelpBtn = document.getElementById('closeHelpBtn');

    if (toggleHelpBtn && helpBanner) {
        toggleHelpBtn.addEventListener('click', function () {
            helpBanner.classList.toggle('hidden');
        });
    }

    if (closeHelpBtn && helpBanner) {
        closeHelpBtn.addEventListener('click', function () {
            helpBanner.classList.add('hidden');
        });
    }

    // 5. Setup Drag-and-Drop file/context attachments in CEP
    var container = document.querySelector('.container');
    var dragOverlay = document.getElementById('dragOverlay');

    if (container && dragOverlay) {
        window.addEventListener('dragover', function (e) {
            e.preventDefault();
            dragOverlay.classList.remove('hidden');
        });

        dragOverlay.addEventListener('dragover', function (e) {
            e.preventDefault();
        });

        dragOverlay.addEventListener('dragenter', function (e) {
            e.preventDefault();
        });

        dragOverlay.addEventListener('dragleave', function (e) {
            e.preventDefault();
            dragOverlay.classList.add('hidden');
        });

        dragOverlay.addEventListener('drop', function (e) {
            e.preventDefault();
            dragOverlay.classList.add('hidden');
            
            var droppedFiles = e.dataTransfer && e.dataTransfer.files;
            if (droppedFiles && droppedFiles.length > 0) {
                logToConsole('Files dropped onto panel. Attaching visual context...');
                if (typeof handleFilesAttach === 'function') {
                    handleFilesAttach(Array.from(droppedFiles));
                } else {
                    logToConsole('Error: handleFilesAttach is not defined.');
                }
            } else {
                logToConsole('Interacted Drag overlay dropped. Fetching selection context...');
                injectSelectionContext();
            }
        });
    }

    // Reload hotkeys listener (F5, Cmd+R, Ctrl+R)
    window.addEventListener('keydown', function (e) {
        if (e.key === 'F5' || ((e.metaKey || e.ctrlKey) && (e.key === 'r' || e.key === 'R' || e.keyCode === 82))) {
            e.preventDefault();
            window.location.reload(true);
        }
    });

    logToConsole('Initialization finished. Assistant stands ready.');
});

// ─── Central Prompt Orchestration ─────────────────────────────────────────────

/**
 * Handles clicks or key entries to send prompts to the AI model.
 * Renders user chats, packs inline images/context, and queries the correct model.
 */
async function handleGenerate() {
    if (isGenerating) {
        if (activeAbortController) {
            activeAbortController.abort();
            logToConsole('Generation aborted by user.');
        }
        return;
    }

    var inputEl = document.getElementById('promptInput');
    var promptText = inputEl.value.trim();

    // Prevent submission if completely empty
    if (!promptText && attachedFiles.length === 0 && attachedContextItems.length === 0) {
        return;
    }

    // Route Draw tab requests directly to specialized drawing handler
    if (currentMode === 'draw') {
        if (!promptText) return;
        handleImageGeneration(promptText);
        return;
    }

    isGenerating = true;
    setStatus('Thinking...', true);

    var generateBtn = document.getElementById('generateBtn');
    var responseCard = document.getElementById('responseCard');

    // Do not disable the button; transform it into a red Stop button instead
    generateBtn.classList.add('generating');
    generateBtn.title = 'Stop Generation';
    generateBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2" ry="2"></rect></svg>';
    inputEl.value = '';

    // Hide previous response card content during query to keep layout clean
    responseCard.innerHTML = '<div class="thinking-skeleton"></div>';
    responseCard.classList.remove('hidden');

    activeAbortController = new AbortController();
    var isSuccess = false;

    // Auto-timeout after 5 minutes (300 seconds)
    var timeoutId = setTimeout(function () {
        if (isGenerating && activeAbortController) {
            logToConsole('Request timed out after 5 minutes. Aborting.');
            activeAbortController.abort();
        }
    }, 300000);

    try {
        // Compile selection context information as a prompt header block
        var contextInfoText = '';
        if (attachedContextItems.length > 0) {
            contextInfoText = "=== CURRENT AFTER EFFECTS CONTEXT REFERENCES ===\n";
            attachedContextItems.forEach(function (item) {
                contextInfoText += "- " + item.name + " (" + item.details + ")\n";
            });
            contextInfoText += "Use these referenced elements exactly to write or explain your script action.\n\n";
        }

        // Format parts array for Gemini multimodal structure
        var userContentParts = [];

        // Insert prompt or context text
        var promptPayloadText = contextInfoText + (promptText || "Execute action based on attached layers.");
        userContentParts.push({ text: promptPayloadText });

        // Insert attached image base64 files
        attachedFiles.forEach(function (file) {
            userContentParts.push({
                inlineData: {
                    mimeType: file.mimeType,
                    data: file.base64Data
                }
            });
        });

        // Save into global chat history
        chatHistory.push({ role: 'user', parts: userContentParts });

        // Update context tracker circle dashboard
        updateContextTracker();

        // 1. Fetch text or code from Gemini API client, passing the abort signal
        var responseText = await fetchGeminiCode(activeAbortController.signal);

        // 2. Render Markdown formatted results
        var renderedText = (currentMode === 'execute') ? '```javascript\n' + responseText + '\n```' : responseText;
        var responseHTML = formatMarkdown(renderedText);
        
        // Создаем диалоговое облачко с запросом пользователя
        var promptBubble = '<div class="user-prompt-bubble">' +
            '<span class="prompt-icon" style="display:flex;align-items:center;">' +
            '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px;">' +
            '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>' +
            '</svg></span>' +
            '<span class="prompt-text">' + (promptText || "Изображение/Контекст") + '</span>' +
            '</div>';
        
        responseCard.innerHTML = promptBubble + responseHTML;

        // 3. Save Assistant responses in history
        chatHistory.push({ role: 'model', parts: [{ text: responseText }] });
        updateContextTracker();

        // 4. Save persistently into logs folder
        saveToPersistentLog(promptText || "[Image/Context only]", responseText, currentMode === 'execute' ? 'SUCCESS (AGENT)' : 'CONSULT');

        // 5. In Agent mode, execute generated code in AE
        if (currentMode === 'execute') {
            executeInAE(responseText);
        } else {
            setStatus('Ready.', false);
        }

        isSuccess = true;

    } catch (err) {
        if (err.name === 'AbortError') {
            logToConsole('Generation aborted successfully.');
            responseCard.innerHTML = '<div style="color:#a78bfa;font-weight:600;padding:6px;">ℹ️ Generation stopped.</div>';
            setStatus('Ready.', false);
        } else {
            logToConsole('Error: ' + err.message);
            responseCard.innerHTML = '<div style="color:#ef4444;font-weight:600;padding:6px;">⚠️ Error: ' + err.message + '</div>';
            setStatus('Error.', false);
            saveToPersistentLog(promptText || "[Image/Context only]", 'Error: ' + err.message, 'API_ERROR');
        }
        
        // Restore the original text so the user doesn't lose it
        inputEl.value = promptText;
    } finally {
        if (timeoutId) {
            clearTimeout(timeoutId);
        }

        // Restore send button visual state
        generateBtn.classList.remove('generating');
        generateBtn.title = 'Generate & Run';
        generateBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>';
        
        isGenerating = false;
        activeAbortController = null;

        // Reset attachments ONLY on successful execution
        if (isSuccess) {
            attachedFiles = [];
            attachedContextItems = [];
            renderPreviews();
            renderContextChips();
        }
    }
}

/**
 * Создает и плавно отображает исчезающее системное уведомление.
 * @param {string} message - Текст уведомления.
 */
function showToast(message) {
    var toast = document.createElement('div');
    toast.className = 'toast-notification';
    
    // Минималистичная SVG иконка инфо-контура
    toast.innerHTML = 
        '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:6px;vertical-align:middle;display:inline-block;">' +
        '<circle cx="12" cy="12" r="10"></circle>' +
        '<line x1="12" y1="16" x2="12" y2="12"></line>' +
        '<line x1="12" y1="8" x2="12.01" y2="8"></line>' +
        '</svg>' +
        '<span>' + message + '</span>';
        
    document.body.appendChild(toast);
    
    // Активируем анимацию появления через микро-тик
    setTimeout(function() {
        toast.classList.add('visible');
    }, 50);
    
    // Плавно скрываем и удаляем из DOM через 2.5 секунды
    setTimeout(function() {
        toast.classList.remove('visible');
        setTimeout(function() {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
        }, 300);
    }, 2500);
}
