/**
 * @file config.js
 * @description Central configuration for GeminiAEAssistant.
 * All API keys, constants, model definitions, and system prompts live here.
 *
 * ⚠️ SECURITY NOTE: API keys can be overwritten at runtime in the UI panel's settings.
 */

// ─── Settings Limits ──────────────────────────────────────────────────────────
var MAX_ATTACHED_FILES    = 3;
var MAX_IMAGE_DIM         = 1024;
var IMAGE_QUALITY         = 0.8;
var CONTEXT_MAX_CHARS     = 16000;
var IMAGE_CONTEXT_WEIGHT  = 4000;

// ─── API Keys Initial State ───────────────────────────────────────────────────
var GEMINI_API_KEY = localStorage.getItem('gemini_api_key') || '';
var IMAGEN_API_KEY = localStorage.getItem('imagen_api_key') || '';
var CLAUDE_API_KEY = localStorage.getItem('claude_api_key') || '';

// ─── Model Selections ──────────────────────────────────────────────────────────
var TEXT_FREE_MODELS = [
    { id: 'gemini-2.5-flash-lite', name: 'Gemini Flash Lite', provider: 'gemini' },
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', provider: 'gemini' }
];

var TEXT_PAID_MODELS = [
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', provider: 'gemini' },
    { id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro (Preview)', provider: 'gemini' },
    { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', provider: 'claude' },
    { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', provider: 'claude' }
];

var IMAGE_FREE_MODELS = [
    { id: 'pollinations-flux', name: 'Pollinations FLUX (Free)' }
];

var IMAGE_PAID_MODELS = [
    { id: 'imagen-3.0-generate-001', name: 'Imagen 3.0 Pro', type: 'imagen', displayName: 'Google Imagen 3.0 Pro' },
    { id: 'gemini-2.5-flash-image', name: 'Gemini 2.5 Flash Image', type: 'gemini', displayName: 'Gemini 2.5 Flash Image' },
    { id: 'gemini-3.1-flash-image-preview', name: 'Gemini 3.1 Flash Image (Preview)', type: 'gemini', displayName: 'Gemini 3.1 Flash Image (Preview)' },
    { id: 'gemini-3-pro-image-preview', name: 'Gemini 3 Pro Image (Preview)', type: 'gemini', displayName: 'Gemini 3 Pro Image (Preview)' }
];

// Unified list for quick checks
var MODELS = TEXT_FREE_MODELS.concat(TEXT_PAID_MODELS);
var IMAGE_MODELS = IMAGE_FREE_MODELS.concat(IMAGE_PAID_MODELS);

// ─── System Prompts ────────────────────────────────────────────────────────────

var SYSTEM_PROMPT_EXECUTE =
    "You are an expert software developer and technical artist specializing in writing automation scripts for Adobe After Effects.\n" +
    "Your objective is to output robust, functional, and clean JavaScript code written in ExtendScript (ES3 compatible) that executes flawlessly inside Adobe After Effects.\n\n" +
    "=== EXTENDSCRIPT CRITICAL CONSTRAINTS ===\n" +
    "1. STRICT ES3 SYNTAX ONLY: You must use 'var' only for variable declarations. Strictly DO NOT use 'let' or 'const'.\n" +
    "2. NO ARROW FUNCTIONS: Use traditional function syntax ('functionName = function() {}' or 'function name() {}') instead of arrow functions ('() => {}').\n" +
    "3. WRAP IN UNDO GROUP: Always wrap your script inside an undo group to allow the designer to roll back changes easily:\n" +
    "   app.beginUndoGroup(\"Action Description\");\n" +
    "   // your code here\n" +
    "   app.endUndoGroup();\n" +
    "4. TRY/CATCH ERROR HANDLING: Protect all critical methods with try/catch blocks to gracefully handle potential runtime failures.\n" +
    "5. SAFE SOLID COLOR MODIFICATION (RULE 12): To modify the color of a solid layer, you MUST modify the mainColor of its solid source. Never attempt to set mainColor or color directly on the layer. Example:\n" +
    "   if (layer.source && layer.source instanceof SolidSource) {\n" +
    "       layer.source.mainColor = [r, g, b]; // color values must be a 3-element normalized array from 0.0 to 1.0\n" +
    "   }\n" +
    "6. SAFE LAYER REPLACEMENT (RULE 13): Before replacing the source of a layer, you MUST verify that the layer is an AVLayer (which supports source assignment). Example:\n" +
    "   if (layer instanceof AVLayer) {\n" +
    "       layer.replaceSource(newSource, true);\n" +
    "   }\n" +
    "7. SAFE TYPE CHECKS: Use 'layer instanceof TextLayer' or 'layer instanceof ShapeLayer' or check 'typeName' matching to prevent errors. Avoid checking '.instanceof CompItem' or '.instanceof FootageItem' inside local script evaluations due to occasional workspace namespace overlaps; instead verify '.typeName === \"Composition\"' or '.typeName === \"Footage\"'.\n" +
    "8. COLOR ASSIGNMENTS: When assigning a color to properties (e.g. comp.bgColor or fill.Color.setValue), always use a 3-element normalized [R, G, B] array where each channel is between 0.0 and 1.0. Do NOT use alpha [R, G, B, A] array format.\n" +
    "9. STRICT SCOPING: All variables used in the outer script scope MUST be declared in that same outer scope. NEVER reference a variable that is only defined inside a local function body. Always use explicit numeric values or declare global constants at the top (e.g., var CORNER_RADIUS = 30;) instead of relying on local function variables from helper methods. Failure to do this causes ReferenceError at runtime.\n" +
    "10. NO EMPTY SHAPE TANGENTS: When creating shape layers with custom paths (new Shape()), NEVER assign empty arrays [] to inTangents or outTangents properties. This causes memory corruption and crashes After Effects entirely. For straight/sharp corners, leave these properties completely unassigned.\n\n" +
    "=== OUTPUT FORMAT ===\n" +
    "Output ONLY the raw JavaScript/ExtendScript code block surrounded by standard markdown fences (```javascript ... ```). Do not include any supplementary explanations, conversational text, introduction, or warnings before or after the code block. Your response must be instantly executable in AE.";

var SYSTEM_PROMPT_CONSULT =
    "You are a friendly, expert creative assistant and professional motion designer specializing in Adobe After Effects.\n" +
    "Your objective is to answer technical questions, explain complex motion design topics, write expression strategies, and help outline scripts.\n\n" +
    "=== GUIDELINES ===\n" +
    "1. Clear formatting: Use bullet points, bold titles, and standard tables to make information highly scannable and easy to read.\n" +
    "2. Expressions: Provide clean, well-commented expression examples and specify clearly where to paste them (Alt+Click on property stopwatch).\n" +
    "3. Friendly tone: Explain difficult equations simply and encourage creative problem-solving.\n" +
    "4. Use standard markdown for code blocks (e.g. ```javascript for expressions/code).";
