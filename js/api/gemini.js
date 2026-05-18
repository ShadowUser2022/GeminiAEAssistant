/**
 * @file api/gemini.js
 * @description Gemini text generation API client.
 *
 * Handles building the request payload for Agent (execute) and Ask (consult)
 * modes and returns the extracted text or code string.
 *
 * Depends on: config.js     (GEMINI_API_KEY, SYSTEM_PROMPT_EXECUTE,
 *                             SYSTEM_PROMPT_CONSULT)
 *             ui/console.js (logToConsole)  — unused directly, errors bubble up
 *
 * Shared globals read: chatHistory (main.js), currentMode (ui/modes.js)
 */

/**
 * Sends the current chat history to the Gemini text API and returns the
 * model's response as a string.
 *
 * In **execute** mode:
 *  - Uses a low temperature (0.1) for deterministic code output.
 *  - Strips the outer ```javascript ... ``` markdown fences and returns
 *    only the raw ExtendScript code.
 *
 * In **consult** mode:
 *  - Uses a higher temperature (0.7) for more natural, conversational replies.
 *  - Returns the full Markdown-formatted response.
 *
 * @returns {Promise<string>} The extracted text or code from the model response.
 * @throws  {Error}           On non-2xx HTTP responses or missing candidates.
 */
async function fetchGeminiCode() {
    var isExecute    = currentMode === 'execute';
    var systemPrompt = isExecute ? SYSTEM_PROMPT_EXECUTE : SYSTEM_PROMPT_CONSULT;
    var temperature  = isExecute ? 0.1 : 0.7;

    var selectedModel = document.getElementById('modelSelect').value;
    var url = 'https://generativelanguage.googleapis.com/v1beta/models/' +
              selectedModel + ':generateContent?key=' + GEMINI_API_KEY;

    var payload = {
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents:          chatHistory,
        generationConfig:  { temperature: temperature }
    };

    var response = await fetch(url, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload)
    });

    if (!response.ok) {
        var errData = await response.json();
        throw new Error((errData.error && errData.error.message) || 'Network error');
    }

    var data       = await response.json();

    // Dynamically update the session cost tracker with Gemini usage metadata
    if (data.usageMetadata && typeof updateSessionCost === 'function') {
        updateSessionCost(selectedModel, data.usageMetadata.promptTokenCount, data.usageMetadata.candidatesTokenCount);
    }

    var textResult = data.candidates[0].content.parts[0].text;

    if (isExecute) {
        // Extract only the code inside the first ```javascript ... ``` block
        var codeBlockMatch = textResult.match(/```(?:javascript|js|extendscript|jsx)?\s*([\s\S]*?)```/i);
        if (codeBlockMatch) {
            textResult = codeBlockMatch[1];
        } else {
            // Fallback: strip any loose fences manually
            textResult = textResult.replace(/^```(javascript|js|extendscript|jsx)?\n?/mi, '');
            textResult = textResult.replace(/```$/m, '');
        }
    }

    return textResult.trim();
}
