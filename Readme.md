# 🎬 Gemini AE Assistant

> An AI-powered Adobe After Effects panel. Describe what you need —
> the assistant generates and runs the script for you.

![Adobe After Effects](https://img.shields.io/badge/After_Effects-2022+-9999FF?style=flat&logo=adobeaftereffects)
![Gemini API](https://img.shields.io/badge/Gemini_API-2.0_Flash_%7C_2.5_Pro-4285F4?style=flat&logo=google)
![CEP](https://img.shields.io/badge/CEP-v11-black?style=flat)

---

## 💡 What Is This?

Gemini AE Assistant is a CEP extension panel for Adobe After Effects that
connects directly to the Google Gemini API. Instead of writing repetitive
ExtendScript manually, you describe your intent in plain English — and the
panel generates, reviews, and executes the code inside your composition.

## ✨ Three Modes

| Mode | What It Does |
|------|-------------|
| **Agent** | Generates ExtendScript from your prompt and runs it live in AE |
| **Ask** | Chat with Gemini about motion design, AE techniques, or anything |
| **Draw** | Generate images via Google Imagen or Pollinations AI and import them directly into the active composition |

## 🏗️ Architecture

```
CEP Panel (HTML / CSS / Vanilla JS)
├── api/gemini.js      → Google Gemini text & code API
├── api/imageGen.js    → Google Imagen + Pollinations AI fallback
├── ui/                → Modes, renderer, attachments, console
├── ae/bridge.js       → Base64 script bridge to ExtendScript
└── jsx/host.jsx       → Runs natively inside After Effects engine
```

No bundlers. No frameworks. Pure CEP + ExtendScript.

## 🚀 Installation

1. Copy the extension folder to:
   - macOS: `~/Library/Application Support/Adobe/CEP/extensions/`
   - Windows: `%APPDATA%\Adobe\CEP\extensions\`
2. Enable unsigned extensions in AE debug mode
3. Open: **Window → Extensions → Gemini AE Assistant**
4. Enter your [Gemini API key](https://aistudio.google.com/) in settings

> ⚠️ This extension is in active development. Core features are stable;
> new capabilities are added regularly.

## 🛠️ Tech Stack

- **UI**: HTML5 · Vanilla CSS (Glassmorphism) · Vanilla JS
- **AI**: Google Gemini 2.0 Flash / 2.5 Pro · Google Imagen · Pollinations AI
- **Scripting**: Adobe ExtendScript (ES3) via CEP bridge
- **Platform**: Adobe CEP 11+ · After Effects 2022+

---

Made by [Anatoliy Petrov](https://www.linkedin.com/in/anatoliy-petrov/)
