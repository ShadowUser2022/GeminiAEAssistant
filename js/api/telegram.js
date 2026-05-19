/**
 * @file api/telegram.js
 * @description Telegram Bot integration for remote After Effects monitoring and control.
 *
 * Implements safe long-polling, secure chat matching, and triggers After Effects
 * commands via the ExtendScript bridge.
 *
 * Safe Client-Side Storage: Credentials are ONLY stored in the user's local
 * browser localStorage. They are never written to source files or committed to Git.
 */

// ─── Global State Variables ──────────────────────────────────────────────────
var telegramPollInterval  = null;
var lastTelegramUpdateId  = 0;
var telegramToken         = '';
var telegramChatId        = '';
var telegramEnabled       = false;
var isTelegramProcessing  = false;
var tgSessionMode         = 'default';

// ─── Initialization & Core Engine ─────────────────────────────────────────────

/**
 * Helper to perform fetch with timeout to prevent infinite hangs.
 */
async function fetchWithTimeout(resource, options) {
    var timeout = (options && options.timeout) || 8000;
    var controller = new AbortController();
    var id = setTimeout(function() { controller.abort(); }, timeout);
    
    var fetchOptions = options || {};
    fetchOptions.signal = controller.signal;
    
    try {
        var response = await fetch(resource, fetchOptions);
        clearTimeout(id);
        return response;
    } catch (err) {
        clearTimeout(id);
        throw err;
    }
}

/**
 * Initializes settings from localStorage and boots up the polling loop if enabled.
 */
function initTelegramBot() {
    logToConsole('Telegram remote module initializing...');

    telegramToken   = localStorage.getItem('gemini_tg_token') || '';
    telegramChatId  = localStorage.getItem('gemini_tg_chatid') || '';
    telegramEnabled = localStorage.getItem('gemini_tg_enabled') === 'true';

    // Set UI values if they exist
    var tgTokenEl   = document.getElementById('tgTokenInput');
    var tgChatIdEl  = document.getElementById('tgChatIdInput');
    var tgEnableEl  = document.getElementById('tgEnableCheckbox');

    if (tgTokenEl) tgTokenEl.value = telegramToken;
    if (tgChatIdEl) tgChatIdEl.value = telegramChatId;
    if (tgEnableEl) tgEnableEl.checked = telegramEnabled;

    // Auto-reconnect listeners when internet connection status changes
    window.addEventListener('online', function() {
        logToConsole('Network connection restored. Reconnecting Telegram Bot...');
        if (telegramEnabled && telegramToken && telegramChatId) {
            startTelegramPolling();
        }
    });

    window.addEventListener('offline', function() {
        logToConsole('Network connection lost. Telegram polling suspended.');
    });

    if (telegramEnabled && telegramToken && telegramChatId) {
        startTelegramPolling();
    } else {
        logToConsole('Telegram bot is disabled or missing credentials.');
    }
}

/**
 * Starts the interval-based Telegram getUpdates loop.
 */
function startTelegramPolling() {
    if (telegramPollInterval) {
        clearInterval(telegramPollInterval);
    }

    logToConsole('Telegram polling loop starting...');
    
    // Quick initial check, then poll every 3.5 seconds
    pollTelegramUpdates();
    telegramPollInterval = setInterval(pollTelegramUpdates, 3500);
}

/**
 * Halts the Telegram long polling.
 */
function stopTelegramPolling() {
    if (telegramPollInterval) {
        clearInterval(telegramPollInterval);
        telegramPollInterval = null;
        logToConsole('Telegram polling loop stopped.');
    }
}

/**
 * Queries getUpdates from the Telegram Bot API.
 */
async function pollTelegramUpdates() {
    if (!telegramToken || !telegramEnabled || isTelegramProcessing) return;

    isTelegramProcessing = true;
    var url = "https://api.telegram.org/bot" + telegramToken + "/getUpdates?offset=" + (lastTelegramUpdateId + 1) + "&timeout=2";

    try {
        var response = await fetchWithTimeout(url, { timeout: 8000 });
        var data = await response.json();

        if (data.ok && data.result && data.result.length > 0) {
            for (var i = 0; i < data.result.length; i++) {
                var update = data.result[i];
                lastTelegramUpdateId = update.update_id;
                
                if (update.message) {
                    await handleTelegramMessage(update.message);
                }
            }
        }
    } catch (err) {
        logToConsole('Telegram poll error: ' + err.message);
    } finally {
        isTelegramProcessing = false;
    }
}

// ─── Command Routing & Event Handlers ─────────────────────────────────────────

/**
 * Validates chat sender and executes matched commands.
 *
 * @param {Object} message - Standard Telegram Message Object.
 */
async function handleTelegramMessage(message) {
    var chatId = message.chat.id.toString().trim();
    var targetChatId = telegramChatId.trim();

    // STRICT SECURITY CHECK: Reject messages from any other chat/user ID
    if (chatId !== targetChatId) {
        logToConsole(`Unauthorized access attempt blocked from Chat ID: ${chatId}`);
        return;
    }

    var text = message.text ? message.text.trim() : '';
    if (!text) return;

    logToConsole(`Telegram command received: "${text}"`);

    // Parse commands (supporting both slash commands and keyboard buttons)
    if (text.startsWith('/start') || text.startsWith('/help') || text === 'ℹ️ Помощь') {
        tgSessionMode = 'default';
        var helpMsg = "🤖 *After Effects Remote Control* 🚀\n\n" +
                      "Используйте кнопки меню ниже или вводите команды вручную:\n" +
                      "📊 `/status` — Характеристики active-проекта и композиции\n" +
                      "📸 `/screen` — Скриншот текущего кадра таймлайна\n" +
                      "🎬 `/render` — Рендеринг active-проекта в видеофайл\n" +
                      "❓ `/ask <вопрос>` — Задать вопрос ИИ без изменения проекта\n" +
                      "⚡️ `/run <промпт>` — Сгенерировать и запустить код (с авто-скриншотом)\n" +
                      "⚙️ `/model` — Выбрать активную модель ИИ\n" +
                      "📖 `Инструкция` — Подробное интерактивное руководство по боту\n\n" +
                      "⚠️ *Настройка:* Если не работает скриншот, убедитесь, что на таймлайне открыта активная композиция и в AE в меню *Preferences -> Scripting & Expressions* включена галочка *Allow Scripts to Write Files*!";
        await sendTelegramMessage(helpMsg);
    } 
    else if (text.startsWith('/status') || text === '📊 Статус') {
        tgSessionMode = 'default';
        await handleStatusCommand();
    } 
    else if (text.startsWith('/model') || text === '⚙️ Сменить модель') {
        tgSessionMode = 'default';
        var parts = text.split(' ');
        if (parts.length === 1) {
            var modelMenu = "⚙️ *Выбор активной модели ИИ*\n\n" +
                            "Кликните на команду ниже, чтобы мгновенно переключить модель на компьютере:\n\n" +
                            "🟢 *Бесплатные (Flash):*\n" +
                            "👉 `/model gemini-2.5-flash-lite` — Gemini Flash Lite (очень быстрая)\n" +
                            "👉 `/model gemini-2.5-flash` — Gemini 2.5 Flash (универсальная)\n\n" +
                            "🔵 *Платные (Pro / Claude):*\n" +
                            "👉 `/model gemini-2.5-pro` — Gemini 2.5 Pro (для сложных задач)\n" +
                            "👉 `/model gemini-3.1-pro-preview` — Gemini 3.1 Pro (Preview)\n" +
                            "👉 `/model claude-3-5-sonnet-20241022` — Claude 3.5 Sonnet (лучшая для кода)\n" +
                            "👉 `/model claude-3-5-haiku-20241022` — Claude 3.5 Haiku (быстрая Anthropic)";
            await sendTelegramMessage(modelMenu);
        } else {
            var requestedId = parts[1].trim();
            var allTextModels = TEXT_FREE_MODELS.concat(TEXT_PAID_MODELS);
            var matchedModel = allTextModels.find(function(m) { return m.id === requestedId; });

            if (matchedModel) {
                var modelSelect = document.getElementById('modelSelect');
                if (modelSelect) {
                    modelSelect.value = requestedId;
                    modelSelect.dispatchEvent(new Event('change'));
                    await sendTelegramMessage(`✅ Активная модель ИИ успешно изменена на *${matchedModel.name}*!`);
                } else {
                    await sendTelegramMessage("❌ Ошибка: Не удалось найти селектор моделей в интерфейсе After Effects.");
                }
            } else {
                await sendTelegramMessage("❌ Неверный ID модели. Используйте список из команды `/model`.");
            }
        }
    } 
    else if (text.startsWith('/screen') || text.startsWith('/screenshot') || text === '📸 Скриншот') {
        tgSessionMode = 'default';
        await handleScreenshotCommand();
    } 
    else if (text.startsWith('/render') || text === '🎬 Рендер') {
        tgSessionMode = 'default';
        await handleRenderCommand();
    } 
    else if (text === '❓ Задать вопрос') {
        tgSessionMode = 'ask';
        var askInstruction = "❓ *Режим консультации активирован!*\n\n" +
                             "Бот проанализирует контекст текущей композиции и ответит без изменения проекта.\n\n" +
                             "👉 *Просто введите ваш вопрос прямо сейчас* (префикс `/ask` больше не нужен!):\n" +
                             "_Пример: Какие слои есть в моей композиции?_";
        await sendTelegramMessage(askInstruction);
    }
    else if (text === '⚡️ Запустить промпт') {
        tgSessionMode = 'run';
        var runInstruction = "⚡️ *Режим выполнения команд активирован!*\n\n" +
                             "Бот сгенерирует ExtendScript-код, выполнит его в AE и автоматически пришлет скриншот результата.\n\n" +
                             "👉 *Просто введите ваш запрос прямо сейчас* (префикс `/run` больше не нужен!):\n" +
                             "_Пример: Создай три шейповых прямоугольника разного цвета_";
        await sendTelegramMessage(runInstruction);
    }
    else if (text.startsWith('/ask ')) {
        tgSessionMode = 'ask';
        var questionText = text.substring(5).trim();
        await handleAskCommand(questionText);
    } 
    else if (text.startsWith('/run ')) {
        tgSessionMode = 'run';
        var promptText = text.substring(5).trim();
        await handleRemotePromptCommand(promptText);
    } 
    else if (text === '📖 Инструкция' || text.startsWith('/guide')) {
        tgSessionMode = 'default';
        var manualMsg = "📖 *Инструкция по работе с Gemini AE Assistant*\n\n" +
                        "Этот бот позволяет вам полностью контролировать After Effects с телефона, пока вы пьете кофе или находитесь в другой комнате!\n\n" +
                        "🔹 *1. Контроль проекта и прогресса*\n" +
                        "• Нажмите *📊 Статус*, чтобы узнать имя открытого проекта, имя активной композиции, разрешение и количество слоев.\n" +
                        "• Нажмите *📸 Скриншот*, чтобы мгновенно получить кадр таймлайна, где сейчас находится ползунок. Отлично подходит для проверки прогресса!\n\n" +
                        "🔹 *2. Удаленный рендеринг*\n" +
                        "• Нажмите *🎬 Рендер*. Бот автоматически отправит активную композицию в очередь рендера After Effects, просчитает видео и пришлет вам готовый файл прямо в чат!\n\n" +
                        "🔹 *3. Креативная работа с ИИ*\n" +
                        "• *❓ Задать вопрос:* нажмите кнопку и просто введите любой вопрос. Например: `Сколько слоев в композиции и как они называются?` ИИ изучит проект и ответит без внесения изменений.\n" +
                        "• *⚡️ Запустить промпт:* нажмите кнопку и просто введите творческое задание. Например: `Создай три шейповых прямоугольника разного цвета`. ИИ напишет ExtendScript, выполнит его в AE и пришлет вам скриншот готового результата!\n\n" +
                        "🔹 *4. Авто-уведомления*\n" +
                        "• Бот автоматически пришлет сообщение на ваш телефон, когда на компьютере завершится генерация изображений (Draw) или генерация скрипта (Agent)!";
        await sendTelegramMessage(manualMsg);
    }
    else {
        if (tgSessionMode === 'ask') {
            await handleAskCommand(text);
        } else if (tgSessionMode === 'run') {
            await handleRemotePromptCommand(text);
        } else {
            await sendTelegramMessage("⚠️ Неизвестная команда. Введите `/help` или используйте кнопки меню ниже.");
        }
    }
}

/**
 * Compiles active AE stats and messages them back.
 */
async function handleStatusCommand() {
    await sendTelegramMessage("⏳ Запрашиваю информацию у After Effects...");

    csInterface.evalScript('getAECompositionStats()', async function (result) {
        if (result && result.indexOf('Error') === -1) {
            try {
                var stats = JSON.parse(result);
                
                // Если активная композиция отсутствует, но проект открыт
                if (stats.success === false) {
                    var noCompMsg = `📊 *Статус After Effects*:\n\n` +
                                    `📁 *Проект:* ${stats.projectName || 'Без имени'}\n` +
                                    `⚠️ *Внимание:* Активная композиция не выбрана на таймлайне.\n\n` +
                                    `_Пожалуйста, дважды кликните по любой композиции в After Effects, чтобы открыть ее на таймлайне, и повторите запрос!_`;
                    await sendTelegramMessage(noCompMsg);
                    return;
                }

                var response = `📊 *Статус After Effects*:\n\n` +
                               `📁 *Проект:* ${stats.projectName || 'Без имени'}\n` +
                               `🎞 *Активная композиция:* \`${stats.activeCompName}\`\n` +
                               `📐 *Разрешение:* ${stats.width}x${stats.height}\n` +
                               `⏱ *Длительность:* ${stats.duration.toFixed(2)} с (${stats.frameRate} fps)\n` +
                               `📦 *Всего слоев:* ${stats.layerCount}`;
                await sendTelegramMessage(response);
            } catch (err) {
                await sendTelegramMessage(`⚠️ Ошибка парсинга данных: ${err.message}. Raw: ${result}`);
            }
        } else {
            await sendTelegramMessage(`❌ Не удалось получить данные. Убедитесь, что After Effects запущен.`);
        }
    });
}

/**
 * Triggers JSX playhead frame exporter and uploads the PNG.
 */
async function handleScreenshotCommand() {
    await sendTelegramMessage("📸 Делаю скриншот таймлайна...");

    const path = require('path');
    var extensionDir = csInterface.getSystemPath(SystemPath.EXTENSION);
    var tempPath = path.join(extensionDir, 'logs', 'ae_telegram_screen.png');

    // Escape backslashes for ExtendScript evaluation
    var escapedTempPath = tempPath.replace(/\\/g, '\\\\');

    csInterface.evalScript(`exportActiveFrameToPath("${escapedTempPath}")`, async function (result) {
        if (result && result.indexOf('Success') !== -1) {
            try {
                await sendTelegramPhoto(tempPath, "🖼 Текущий прогресс таймлайна After Effects");
            } catch (err) {
                await sendTelegramMessage(`❌ Скриншот создан, но не отправлен: ${err.message}`);
            }
        } else {
            await sendTelegramMessage(`❌ Ошибка создания скриншота: ${result}`);
        }
    });
}

/**
 * Triggers composition render and returns the exported video/document.
 */
async function handleRenderCommand() {
    await sendTelegramMessage("🎬 Запускаю рендер композиции. Пожалуйста, подождите (интерфейс AE может временно зависнуть)...");

    const path = require('path');
    var extensionDir = csInterface.getSystemPath(SystemPath.EXTENSION);
    var tempRenderPath = path.join(extensionDir, 'logs', 'ae_telegram_render.mov');
    var escapedPath = tempRenderPath.replace(/\\/g, '\\\\');

    csInterface.evalScript(`triggerActiveCompRender("${escapedPath}")`, async function (result) {
        if (result && result.indexOf('Success') !== -1) {
            await sendTelegramMessage("✅ Рендер завершен! Считываю файл для отправки...");
            try {
                await sendTelegramDocument(tempRenderPath, "🎥 Готовый рендер активной композиции!");
            } catch (err) {
                await sendTelegramMessage(`❌ Рендер выполнен успешно, но не удалось отправить файл: ${err.message}`);
            }
        } else {
            await sendTelegramMessage(`❌ Ошибка во время рендера: ${result}`);
        }
    });
}

/**
 * Запрашивает Gemini в режиме консультации (Ask) для ответа на вопрос с учетом контекста состава.
 * Не выполняет никакого сгенерированного кода в After Effects.
 *
 * @param {string} questionText - Текст вопроса от пользователя.
 */
async function handleAskCommand(questionText) {
    await sendTelegramMessage(`🔍 Изучаю проект и формулирую ответ на вопрос:\n"${questionText}"...`);

    try {
        // 1. Получаем текущую статистику композиции для передачи в контекст ИИ
        csInterface.evalScript('getAECompositionStats()', async function (statsResult) {
            var contextPrefix = "";
            if (statsResult && statsResult.indexOf('Error') === -1) {
                try {
                    var stats = JSON.parse(statsResult);
                    if (stats.success !== false) {
                        contextPrefix = `[Контекст текущей композиции After Effects]\n` +
                                        `- Открытый проект: ${stats.projectName || 'Без имени'}\n` +
                                        `- Активная композиция: ${stats.activeCompName}\n` +
                                        `- Разрешение: ${stats.width}x${stats.height}\n` +
                                        `- Длительность: ${stats.duration.toFixed(2)} сек (${stats.frameRate} fps)\n` +
                                        `- Всего слоев на таймлайне: ${stats.layerCount}\n\n`;
                    } else {
                        contextPrefix = `[Контекст проекта After Effects]\n` +
                                        `- Открытый проект: ${stats.projectName || 'Без имени'}\n` +
                                        `- Внимание: Активная композиция на таймлайне не выбрана.\n\n`;
                    }
                } catch (e) {
                    // Игнорируем ошибки парсинга, если проект пуст
                }
            }

            // 2. Подготавливаем запрос, переключая модель в режим консультации (ask)
            var previousMode = currentMode;
            currentMode = 'ask'; 

            var fullPrompt = contextPrefix + 
                             "Пожалуйста, ответь на вопрос пользователя о его проекте After Effects. " +
                             "Отвечай развернуто, структурировано на русском языке. Вопрос:\n" + questionText;

            // Добавляем в историю чата
            chatHistory.push({ role: 'user', parts: [{ text: fullPrompt }] });
            if (typeof updateContextTracker === 'function') updateContextTracker();

            try {
                setStatus('Consulting AI...', true);
                var answer = await fetchGeminiCode(null);

                // Добавляем ответ ИИ в историю
                chatHistory.push({ role: 'model', parts: [{ text: answer }] });
                if (typeof updateContextTracker === 'function') updateContextTracker();

                if (typeof saveToPersistentLog === 'function') {
                    saveToPersistentLog(questionText, answer, 'SUCCESS (REMOTE ASK)');
                }

                // 3. Отправляем форматированный ответ в Telegram
                await sendTelegramMessage(`💡 *Ответ ассистента*:\n\n${answer}`);
                setStatus('Ready.', false);

            } catch (apiErr) {
                logToConsole('Remote Ask Error: ' + apiErr.message);
                await sendTelegramMessage(`❌ Ошибка генерации ответа: ${apiErr.message}`);
                setStatus('Ready.', false);
            } finally {
                // Возвращаем исходный режим панели
                currentMode = previousMode; 
            }
        });

    } catch (err) {
        logToConsole('Ask command init error: ' + err.message);
        await sendTelegramMessage(`❌ Ошибка инициализации команды: ${err.message}`);
    }
}

/**
 * Automatically prompts Gemini API, executes JSX, and screenshots result.
 *
 * @param {string} promptText - The user prompt received from phone.
 */
async function handleRemotePromptCommand(promptText) {
    await sendTelegramMessage(`🧠 Передаю ИИ-ассистенту промпт:\n"${promptText}"\n\nОжидайте генерации и выполнения...`);

    // We can simulate UI flow on the panel so the user sees remote actions in real-time
    var inputEl = document.getElementById('promptInput');
    if (inputEl) {
        inputEl.value = "[Telegram Remote]: " + promptText;
    }

    try {
        setStatus('Remote Agent executing...', true);
        
        var userContentParts = [{ text: promptText }];
        chatHistory.push({ role: 'user', parts: userContentParts });
        if (typeof updateContextTracker === 'function') updateContextTracker();

        var responseText = await fetchGeminiCode(null); // Execute standard gemini fetch
        
        var responseCard = document.getElementById('responseCard');
        if (responseCard) {
            var renderedText = (currentMode === 'execute') ? '```javascript\n' + responseText + '\n```' : responseText;
            var responseHTML = formatMarkdown(renderedText);
            
            // Обозначаем, что запрос пришел удаленно
            var promptBubble = '<div class="user-prompt-bubble">' +
                '<span class="prompt-icon" style="display:flex;align-items:center;gap:4px;">' +
                '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
                '<rect x="5" y="2" width="14" height="20" rx="2" ry="2"></rect>' +
                '<line x1="12" y1="18" x2="12.01" y2="18"></line>' +
                '</svg>Telegram:</span>' +
                '<span class="prompt-text">' + promptText + '</span>' +
                '</div>';
                
            responseCard.innerHTML = promptBubble + responseHTML;
            responseCard.classList.remove('hidden');
        }

        chatHistory.push({ role: 'model', parts: [{ text: responseText }] });
        if (typeof updateContextTracker === 'function') updateContextTracker();

        if (typeof saveToPersistentLog === 'function') {
            saveToPersistentLog(promptText, responseText, 'SUCCESS (REMOTE AGENT)');
        }

        // Run in AE
        executeInAE(responseText);

        await sendTelegramMessage("✅ Код успешно сгенерирован и выполнен в After Effects! Создаю скриншот результата...");
        
        // Take screenshot of output automatically
        setTimeout(async function () {
            await handleScreenshotCommand();
        }, 1500);

    } catch (err) {
        logToConsole('Remote prompt error: ' + err.message);
        await sendTelegramMessage(`❌ Ошибка генерации: ${err.message}`);
        setStatus('Ready.', false);
    }
}

// ─── Network Transmission Utilities ───────────────────────────────────────────

/**
 * Sends standard text message to the configured Chat ID.
 *
 * @param {string} text - Message text.
 */
async function sendTelegramMessage(text) {
    if (!telegramToken || !telegramChatId) return;

    var url = `https://api.telegram.org/bot${telegramToken}/sendMessage`;
    try {
        await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                chat_id: telegramChatId,
                text: text,
                parse_mode: 'Markdown',
                reply_markup: {
                    keyboard: [
                        [{"text": "📊 Статус"}, {"text": "📸 Скриншот"}],
                        [{"text": "🎬 Рендер"}, {"text": "ℹ️ Помощь"}],
                        [{"text": "❓ Задать вопрос"}, {"text": "⚡️ Запустить промпт"}],
                        [{"text": "⚙️ Сменить модель"}, {"text": "📖 Инструкция"}]
                    ],
                    resize_keyboard: true
                }
            })
        });
    } catch (err) {
        logToConsole('TG Send message failed: ' + err.message);
    }
}

/**
 * Uploads a local image file directly via Telegram Bot multi-part form.
 *
 * @param {string} filePath - Absolute path to local PNG file.
 * @param {string} caption - Photo text caption.
 */
async function sendTelegramPhoto(filePath, caption) {
    if (!telegramToken || !telegramChatId) return;

    var fs = require('fs');
    var fileBuffer = fs.readFileSync(filePath);
    var blob = new Blob([fileBuffer], { type: 'image/png' });

    var formData = new FormData();
    formData.append('chat_id', telegramChatId);
    formData.append('caption', caption);
    formData.append('photo', blob, 'screenshot.png');

    var url = `https://api.telegram.org/bot${telegramToken}/sendPhoto`;
    await fetch(url, {
        method: 'POST',
        body: formData
    });
    logToConsole('Telegram photo uploaded successfully.');
}

/**
 * Uploads a video/document from disk to the configured chat.
 * Supports up to 50MB files via Telegram standard Bot API.
 *
 * @param {string} filePath - Absolute path to local file.
 * @param {string} caption - Document label.
 */
async function sendTelegramDocument(filePath, caption) {
    if (!telegramToken || !telegramChatId) return;

    var fs = require('fs');
    var path = require('path');
    
    var fileName = path.basename(filePath);
    var fileBuffer = fs.readFileSync(filePath);
    
    // Resolve mime type or use default stream octet
    var blob = new Blob([fileBuffer], { type: 'application/octet-stream' });

    var formData = new FormData();
    formData.append('chat_id', telegramChatId);
    formData.append('caption', caption);
    formData.append('document', blob, fileName);

    var url = `https://api.telegram.org/bot${telegramToken}/sendDocument`;
    var response = await fetch(url, {
        method: 'POST',
        body: formData
    });
    var data = await response.json();
    if (!data.ok) {
        throw new Error(data.description || 'Unknown API upload error');
    }
    logToConsole('Telegram document uploaded successfully.');
}
