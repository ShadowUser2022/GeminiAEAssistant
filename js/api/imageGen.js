/**
 * @file api/imageGen.js
 * @description Image generation API client — Pollinations AI (FLUX) and Google Imagen/Gemini.
 *
 * Entry point: handleImageGeneration(promptText)
 * Also exports: resolveAvailableImageModels()
 *
 * Depends on: config.js     (IMAGEN_API_KEY, IMAGE_MODELS)
 *             ui/console.js (logToConsole, setStatus)
 *             ae/bridge.js  (csInterface via global)
 *
 * Shared globals read: drawSubMode, activeChromaColor (ui/modes.js)
 *                      isGenerating (main.js — written here too)
 */

// ─── Model Discovery ──────────────────────────────────────────────────────────

/**
 * Queries the Gemini models endpoint to find which IMAGE_MODELS are actually
 * available under the current IMAGEN_API_KEY. Returns a filtered subset or
 * null if the query fails or yields no matches.
 *
 * @returns {Promise<Array|null>}
 */
async function resolveAvailableImageModels() {
    try {
        logToConsole('Querying available models from Gemini API...');
        var listUrl = 'https://generativelanguage.googleapis.com/v1beta/models?key=' + IMAGEN_API_KEY;
        var listRes = await fetch(listUrl);

        if (listRes.ok) {
            var listData = await listRes.json();
            if (listData.models && listData.models.length > 0) {
                var apiModelNames = listData.models.map(function (m) { return m.name.split('/').pop(); });
                logToConsole('Fetched API models: ' + apiModelNames.join(', '));

                var available = IMAGE_MODELS.filter(function (m) { return apiModelNames.includes(m.name); });
                if (available.length > 0) {
                    logToConsole('Found matching active image models: ' + available.map(function (m) { return m.name; }).join(', '));
                    return available;
                }
            }
        }
    } catch (e) {
        logToConsole('Dynamic model resolution notice: ' + e.message);
    }
    return null;
}

// ─── Prompt Modifier: Isolated Asset ─────────────────────────────────────────

/**
 * Builds the chroma-key background description string for the active colour.
 *
 * @returns {string} CSS-colour description suitable for appending to a prompt.
 */
function buildChromaDesc() {
    switch (activeChromaColor) {
        case 'magenta': return 'solid bright flat #FF00FF magenta / hot-pink';
        case 'blue':    return 'solid bright flat #0055FF blue screen';
        case 'black':   return 'solid flat pure black #000000';
        case 'white':   return 'solid flat pure white #FFFFFF';
        default:        return 'solid bright flat #00FF00 green screen'; // green
    }
}

/**
 * Optionally augments the prompt for "Isolated Asset" sub-mode by appending
 * a detailed chroma-key background description so the AI places the subject
 * on a perfectly clean, solid-colour background — ready for keying in AE.
 *
 * @param  {string} promptText - Original user prompt.
 * @returns {string} Modified prompt (unchanged in 'scene' sub-mode).
 */
function buildFinalPrompt(promptText) {
    if (drawSubMode !== 'element') return promptText;

    var chromaDesc = buildChromaDesc();
    logToConsole('Applying isolated asset prompt modifier with ' + activeChromaColor + ' (' + chromaDesc + ') background...');

    return promptText +
        ', isolated on a perfectly uniform, flat 2D ' + chromaDesc +
        ' background. Absolutely no shadows on the background, no gradients, no reflections,' +
        ' no floor contact shadows, sharp clean edges, studio lighting on the object, centered,' +
        ' complete asset, perfect for easy chroma keying';
}

// ─── Pollinations AI (FLUX) ───────────────────────────────────────────────────

/**
 * Generates an image via Pollinations AI (FLUX model) — free, no API key required.
 * Selects dimensions that best match the given aspect ratio string.
 *
 * @param  {string} promptText - The (possibly augmented) image prompt.
 * @param  {string} aspect     - Aspect ratio string e.g. "16:9", "1:1".
 * @returns {Promise<{b64Data: string, extension: string}>}
 * @throws {Error} If the Pollinations request fails.
 */
async function generateWithPollinations(promptText, aspect) {
    var w = 1024, h = 1024;
    if      (aspect === '16:9') { w = 1344; h = 768;  }
    else if (aspect === '9:16') { w = 768;  h = 1344; }
    else if (aspect === '4:3')  { w = 1152; h = 896;  }
    else if (aspect === '3:4')  { w = 896;  h = 1152; }

    logToConsole('Attempting image generation with Pollinations AI (FLUX) for ' + aspect + ' ratio...');

    var url = 'https://image.pollinations.ai/p/' + encodeURIComponent(promptText) +
              '?width=' + w + '&height=' + h + '&nologo=true&private=true&model=flux';

    var res = await fetch(url);
    if (!res.ok) throw new Error('Pollinations AI error: ' + res.statusText);

    var blob      = await res.blob();
    var extension = blob.type && blob.type.includes('jpeg') ? 'jpg' : 'png';

    var b64Data = await new Promise(function (resolve) {
        var reader    = new FileReader();
        reader.onloadend = function () { resolve(reader.result.split(',')[1]); };
        reader.readAsDataURL(blob);
    });

    if (!b64Data) throw new Error('Pollinations AI returned empty image data.');
    return { b64Data: b64Data, extension: extension };
}

// ─── Google Imagen / Gemini Image ────────────────────────────────────────────

/**
 * Generates an image using a Google model (Imagen or Gemini multimodal).
 * Builds the appropriate request payload for each model type.
 *
 * @param  {Object} model      - Entry from IMAGE_MODELS: { name, type, displayName }.
 * @param  {string} prompt     - The (possibly augmented) image prompt.
 * @param  {string} aspect     - Aspect ratio string.
 * @returns {Promise<{b64Data: string, extension: string}>}
 * @throws {Error} If the request fails or returns no image data.
 */
async function generateWithGoogleModel(model, prompt, aspect) {
    logToConsole('Attempting image generation with: ' + model.name + ' (' + aspect + ' ratio)...');

    var url, payload;

    if (model.type === 'gemini') {
        url = 'https://generativelanguage.googleapis.com/v1beta/models/' +
              model.name + ':generateContent?key=' + IMAGEN_API_KEY;
        payload = {
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
                responseModalities: ['IMAGE'],
                imageConfig: { aspectRatio: aspect }
            }
        };
    } else {
        // Imagen model uses the predict endpoint
        url = 'https://generativelanguage.googleapis.com/v1beta/models/' +
              model.name + ':predict?key=' + IMAGEN_API_KEY;
        payload = {
            instances:  [{ prompt: prompt }],
            parameters: { sampleCount: 1, aspectRatio: aspect, outputMimeType: 'image/png' }
        };
    }

    var res = await fetch(url, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload)
    });

    if (!res.ok) {
        var errData = await res.json().catch(function () { return {}; });
        throw new Error((errData.error && errData.error.message) || res.statusText);
    }

    var data      = await res.json();
    var b64Data   = null;
    var extension = 'png';

    if (model.type === 'gemini') {
        var candidatesList = data.candidates;
        if (candidatesList && candidatesList.length > 0 && candidatesList[0].content) {
            for (var i = 0; i < candidatesList[0].content.parts.length; i++) {
                var part       = candidatesList[0].content.parts[i];
                var inlineData = part.inlineData || part.inline_data;
                if (inlineData && inlineData.data) {
                    b64Data = inlineData.data;
                    var mime = inlineData.mimeType || inlineData.mime_type;
                    if (mime && mime.includes('jpeg')) extension = 'jpg';
                    break;
                }
            }
        }
    } else {
        // Imagen
        if (data.predictions && data.predictions.length > 0 && data.predictions[0].bytesBase64Encoded) {
            b64Data = data.predictions[0].bytesBase64Encoded;
        }
    }

    if (!b64Data) throw new Error('Google model returned no image data.');
    return { b64Data: b64Data, extension: extension };
}

// ─── Save & Import Into AE ────────────────────────────────────────────────────

/**
 * Saves the generated image (base64) to Documents/Gemini_AE_Generated/
 * via the CEP filesystem API, then calls importGeneratedImage() in ExtendScript
 * to import it into the active composition.
 *
 * @param {string} b64Data     - Raw base64 image data.
 * @param {string} extension   - File extension: 'png' or 'jpg'.
 * @param {string} modelName   - Display name of the model used (for logging).
 * @param {HTMLElement} responseCard - The response card element to update.
 * @param {HTMLElement} btn    - The generate button (to re-enable).
 */
function saveAndImportImage(b64Data, extension, modelName, responseCard, btn) {
    logToConsole('Success! Image generated using: ' + modelName);

    // Track usage cost persistently (1 image)
    var selectedModel = document.getElementById('modelSelect').value;
    if (typeof updateSessionCost === 'function') {
        updateSessionCost(selectedModel, 0, 0, 1);
    }

    // Create output folder
    var folderPath = csInterface.getSystemPath(SystemPath.MY_DOCUMENTS) + '/Gemini_AE_Generated';
    window.cep.fs.makedir(folderPath);

    var timestamp = new Date().getTime();
    var filename  = 'ai_layer_' + timestamp + '.' + extension;
    var filePath  = folderPath + '/' + filename;

    var encoding    = (window.cep && window.cep.encoding && window.cep.encoding.Base64) ? window.cep.encoding.Base64 : 'Base64';
    var writeResult = window.cep.fs.writeFile(filePath, b64Data, encoding);

    if (writeResult.err !== 0) {
        throw new Error('Failed to write generated image file locally.');
    }

    logToConsole('Saved image to Documents/Gemini_AE_Generated/' + filename + '. Importing to AE...');

    // Import into AE via ExtendScript bridge
    csInterface.evalScript('importGeneratedImage("' + filePath + '")', function (importResult) {
        try {
            var parsed = JSON.parse(importResult);
            if (parsed.success) {
                logToConsole('Image imported and added to composition successfully!');
                setStatus('Ready.', false);
                // Send push notification to Telegram if enabled
                if (typeof sendTelegramMessage === 'function' && telegramEnabled && telegramToken) {
                    sendTelegramMessage("🎨 *Генерация изображения завершена!*\nНовый слой `" + filename + "` успешно импортирован на таймлайн в After Effects.");
                }
            } else {
                logToConsole('ExtendScript Import Error: ' + parsed.error);
                setStatus('Import error.', false);
            }
        } catch (e) {
            logToConsole('Import response parsing error.');
            setStatus('Ready.', false);
        }
    });

    // Show visual preview in the response card
    responseCard.innerHTML =
        '<div style="text-align:center;padding:6px;">' +
        '<p style="margin-bottom:8px;"><strong>Generated Design Layer</strong></p>' +
        '<img src="data:image/png;base64,' + b64Data + '" ' +
        'style="max-width:100%;border-radius:var(--radius-md);border:1px solid var(--border-color);' +
        'box-shadow:0 4px 12px rgba(0,0,0,0.3);margin-bottom:8px;" />' +
        '<p style="font-size:10px;color:var(--text-muted);margin:0;">Saved locally in your Documents folder.</p>' +
        '</div>';
    responseCard.classList.remove('hidden');
}

// ─── Main Entry Point ─────────────────────────────────────────────────────────

/**
 * Orchestrates the full image generation flow for Draw mode.
 *
 * Steps:
 *  1. Lock UI (disable button, set status).
 *  2. Optionally augment the prompt (Isolated Asset sub-mode).
 *  3. Query the active comp's aspect ratio from AE via CSInterface.
 *  4. Generate the image using the selected model.
 *  5. Save the image to disk and import it into AE.
 *  6. Restore UI state.
 *
 * @param {string} promptText - The raw user prompt from #promptInput.
 */
async function handleImageGeneration(promptText) {
    isGenerating = true;
    setStatus('Drawing image...', true);

    var btn          = document.getElementById('generateBtn');
    var responseCard = document.getElementById('responseCard');
    btn.disabled     = true;

    document.getElementById('promptInput').value = '';

    var finalPrompt = buildFinalPrompt(promptText);

    try {
        // Get composition aspect ratio from ExtendScript
        csInterface.evalScript('getActiveCompAspectRatio()', async function (ratioResult) {
            var aspect        = '1:1'; // safe default
            var selectedModel = document.getElementById('modelSelect').value;

            // Map composition aspect ratio dynamically to standard standard Imagen ratios
            if (ratioResult) {
                var parts = ratioResult.split(':');
                if (parts.length === 2) {
                    var w = parseFloat(parts[0]);
                    var h = parseFloat(parts[1]);
                    if (!isNaN(w) && !isNaN(h) && h > 0) {
                        var ratio = w / h;
                        var standardRatios = [
                            { name: '16:9', val: 16/9 },
                            { name: '4:3',  val: 4/3 },
                            { name: '1:1',  val: 1/1 },
                            { name: '3:4',  val: 3/4 },
                            { name: '9:16', val: 9/16 }
                        ];
                        var closest = standardRatios[0];
                        var minDiff = Math.abs(ratio - closest.val);
                        for (var idx = 1; idx < standardRatios.length; idx++) {
                            var diff = Math.abs(ratio - standardRatios[idx].val);
                            if (diff < minDiff) {
                                minDiff = diff;
                                closest = standardRatios[idx];
                            }
                        }
                        aspect = closest.name;
                        logToConsole('Mapped composition shape (' + ratioResult + ') to standard aspect ratio: ' + aspect);
                    }
                }
            }

            // Protect against accidental paid model token usage
            if (selectedModel !== 'pollinations-flux') {
                var modelEntry = IMAGE_MODELS.find(function (m) { return m.name === selectedModel; }) || IMAGE_MODELS[0];
                var proceed = confirm(
                    "⚠️ Внимание!\n\n" +
                    "Вы выбрали платную модель Google (" + modelEntry.displayName + ").\n" +
                    "Эта генерация спишет средства с вашего баланса Google Cloud API ($0.03).\n\n" +
                    "Хотите продолжить?"
                );
                if (!proceed) {
                    logToConsole('Generation cancelled to protect API budget.');
                    setStatus('Ready.', false);
                    btn.disabled = false;
                    isGenerating = false;
                    if (typeof saveToPersistentLog === 'function') {
                        saveToPersistentLog(promptText, 'User cancelled generation to protect API budget.', 'CANCELLED (DRAW)');
                    }
                    return;
                }
            }

            try {
                var b64Data    = null;
                var extension  = 'png';
                var modelName  = selectedModel;

                if (selectedModel === 'pollinations-flux') {
                    var polResult = await generateWithPollinations(finalPrompt, aspect);
                    b64Data       = polResult.b64Data;
                    extension     = polResult.extension;
                    modelName     = 'Pollinations AI FLUX';

                } else {
                    var modelEntry = IMAGE_MODELS.find(function (m) { return m.name === selectedModel; }) || IMAGE_MODELS[0];
                    var gResult    = await generateWithGoogleModel(modelEntry, finalPrompt, aspect);
                    b64Data        = gResult.b64Data;
                    extension      = gResult.extension;
                    modelName      = modelEntry.displayName;
                }

                if (!b64Data) throw new Error('Image generation failed. Please check your API key permissions/billing status or try again.');

                saveAndImportImage(b64Data, extension, modelName, responseCard, btn);

                if (typeof saveToPersistentLog === 'function') {
                    saveToPersistentLog(promptText, '[IMAGE GENERATED SUCCESSFULLY]\nModel: ' + modelName + '\nAspect: ' + aspect + '\nExtension: ' + extension + '\nFinal Prompt: ' + finalPrompt, 'SUCCESS (DRAW)');
                }

            } catch (apiErr) {
                logToConsole('Image API Error: ' + apiErr.message);
                setStatus('Error.', false);
                if (typeof saveToPersistentLog === 'function') {
                    saveToPersistentLog(promptText, 'Image API Error: ' + apiErr.message + '\nFinal Prompt: ' + finalPrompt, 'API_ERROR (DRAW)');
                }
            } finally {
                btn.disabled = false;
                isGenerating = false;
            }
        });

    } catch (err) {
        logToConsole('Image Gen Initial Error: ' + err.message);
        setStatus('Error.', false);
        btn.disabled = false;
        isGenerating = false;
    }
}
