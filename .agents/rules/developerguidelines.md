---
trigger: always_on
glob: "**/*.{js,jsx,html,css,md}"
description: "Development standards, ES3 safety, and design rules for GeminiAEAssistant"
---

# 📋 AI Assistant Instructions

## 1. Architectural Rules
*   **Strict Separation:** Maintain the architecture: CEP UI (HTML5/CSS/Vanilla JS) -> Base64 Bridge -> ExtendScript (JSX).
*   **Decoupled Modules:** Keep logic separated: UI controllers in `js/ui/`, API clients in `js/api/`, bridge scripts in `js/ae/`, and native After Effects scripts in `jsx/`.
*   **No Global Pollution:** Always load script dependencies in the correct order in `index.html` and do not mix logic.

## 2. ExtendScript Constraints (ES3)
*   **Strict ES3 Syntax:** Use `var` only (strictly no `let` or `const`). Use traditional functions (strictly no arrow functions `() => {}`).
*   **IIFE Wrapper:** Wrap all ExtendScript native logic in an Immediately Invoked Function Expression (IIFE) to avoid global namespace conflicts.
*   **Safe Error Handling:** Protect all JSX methods with `try/catch` blocks and return formatted JSON error strings back to CEP.
*   **No Native JSON:** Avoid using native `JSON` inside ExtendScript. Use manual string escaping and safe string concatenation.

## 3. UI & Design Requirements
*   **Color Palette:** Use deep cosmic black (`#0d0f12`) as the main background and neon amethyst (`#a78bfa`) as the primary accent color.
*   **Glassmorphism:** Apply premium translucent glass effects using `background: rgba(...)` combined with `backdrop-filter: blur(...)`.
*   **Micro-animations:** Incorporate smooth transition effects and glow shadows for interactive states to maintain a premium feel.

## 4. Concurrent Agent Safety (Multi-Agent Isolation)
*   **No Overlapping Edits:** AI agents must never modify the same file or edit the same function concurrently.
*   **Check Git State:** Before making any file changes, run `git status` to verify there are no active uncommitted modifications from other agents.
*   **Strict Scoping:** Only modify files directly related to your current task branch. Do not touch adjacent modules being edited by other agents.
