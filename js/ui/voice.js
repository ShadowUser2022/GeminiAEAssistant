/**
 * @file ui/voice.js
 * @description Voice control manager for Speech-to-Text (STT) and Text-to-Speech (TTS).
 *
 * Implements browser SpeechRecognition and SpeechSynthesis, custom audio cues,
 * stop-word processing, and continuous dialog loops.
 *
 * Shared globals: handleGenerate (main.js), logToConsole (ui/console.js), showToast (main.js)
 */

var voiceLanguage = 'RU'; // 'RU', 'UA', or 'EN'
var voiceContinuous = false;
var isListening = false;
var isSpeaking = false;

var recognition = null;
var currentUtterance = null;
var continuousRestartTimeout = null;

var mediaRecorder = null;
var audioChunks = [];
var audioStream = null;
var voiceFallbackActive = false;
window.recordedAudioData = null;
var silenceDetectionInterval = null;
var audioContextForSilence = null;
var analyserForSilence = null;
var streamSourceForSilence = null;

// Stop words defined per language
var STOP_WORDS = {
    'RU': ['стоп', 'хватит', 'достаточно', 'перестань', 'остановись', 'пауза'],
    'UA': ['стоп', 'досить', 'зупинись', 'перестань', 'зупинка', 'пауза'],
    'EN': ['stop', 'enough', 'cancel', 'pause', 'exit', 'quit', 'shut up']
};

// Lang code mapping for SpeechRecognition/Synthesis
var LANG_CODES = {
    'RU': 'ru-RU',
    'UA': 'uk-UA',
    'EN': 'en-US'
};

/**
 * Synthesizes a clean audio beep using Web Audio API for interactive feedback.
 * @param {number} frequency - Frequency in Hz
 * @param {number} duration - Duration in seconds
 */
function playVoiceBeep(frequency, duration) {
    try {
        var AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) return;
        
        var audioCtx = new AudioContextClass();
        var oscillator = audioCtx.createOscillator();
        var gainNode = audioCtx.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        
        oscillator.type = 'sine';
        oscillator.frequency.value = frequency;
        
        gainNode.gain.setValueAtTime(0.08, audioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
        
        oscillator.start();
        oscillator.stop(audioCtx.currentTime + duration);
    } catch (e) {
        logToConsole('Beep audio failed: ' + e.message);
    }
}

/**
 * Initializes the SpeechRecognition instance.
 */
function initSpeechRecognition() {
    var SpeechRecognitionClass = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognitionClass) {
        logToConsole('SpeechRecognition is not supported in this environment. Activating MediaRecorder audio fallback.');
        voiceFallbackActive = true;
        return true;
    }
    
    recognition = new SpeechRecognitionClass();
    recognition.continuous = false;
    recognition.interimResults = false;
    
    recognition.onstart = function() {
        isListening = true;
        updateVoiceUI();
        playVoiceBeep(880, 0.08); // High pitch beep for activation
        logToConsole('Speech recognition started (' + LANG_CODES[voiceLanguage] + ')...');
    };
    
    recognition.onresult = function(event) {
        if (event.results && event.results[0] && event.results[0][0]) {
            var transcript = event.results[0][0].transcript.trim();
            logToConsole('Recognized speech: "' + transcript + '"');
            processSpeechResult(transcript);
        }
    };
    
    recognition.onerror = function(event) {
        logToConsole('Speech recognition error: ' + event.error);
        if (event.error === 'not-allowed') {
            showToast('Доступ к микрофону заблокирован. Разрешите его в Системных настройках macOS.');
            stopContinuousDialog();
        }
        isListening = false;
        updateVoiceUI();
    };
    
    recognition.onend = function() {
        isListening = false;
        updateVoiceUI();
        logToConsole('Speech recognition ended.');
    };
    
    return true;
}

async function startMediaRecorderListening() {
    if (isListening) return;
    audioChunks = [];
    
    try {
        audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
        logToConsole('Microphone permission denied or media error: ' + err.message);
        showToast('Доступ к микрофону заблокирован. Разрешите его в Системных настройках macOS.');
        isListening = false;
        updateVoiceUI();
        return;
    }
    
    try {
        var options = { mimeType: 'audio/webm' };
        if (!MediaRecorder.isTypeSupported('audio/webm')) {
            options = { mimeType: 'audio/ogg' };
            if (!MediaRecorder.isTypeSupported('audio/ogg')) {
                options = { mimeType: 'audio/mp4' };
                if (!MediaRecorder.isTypeSupported('audio/mp4')) {
                    options = {};
                }
            }
        }
        
        mediaRecorder = new MediaRecorder(audioStream, options);
        
        mediaRecorder.ondataavailable = function(e) {
            if (e.data && e.data.size > 0) {
                audioChunks.push(e.data);
            }
        };
        
        mediaRecorder.onstart = function() {
            isListening = true;
            updateVoiceUI();
            playVoiceBeep(880, 0.08); // High pitch beep for activation
            logToConsole('Audio recording started (MediaRecorder, mimeType: ' + (options.mimeType || 'default') + ')...');
            
            // Start silence detection to automatically stop when the user stops speaking
            setupSilenceDetection(audioStream);
        };
        
        mediaRecorder.onstop = async function() {
            logToConsole('Audio recording stopped. Processing audio...');
            var mimeType = options.mimeType || mediaRecorder.mimeType || 'audio/webm';
            
            if (audioStream) {
                var tracks = audioStream.getTracks();
                for (var i = 0; i < tracks.length; i++) {
                    tracks[i].stop();
                }
                audioStream = null;
            }
            
            cleanupSilenceDetection();
            
            if (audioChunks.length === 0) {
                logToConsole('No audio data captured.');
                isListening = false;
                updateVoiceUI();
                return;
            }
            
            var audioBlob = new Blob(audioChunks, { type: mimeType });
            audioChunks = [];
            
            var reader = new FileReader();
            reader.readAsDataURL(audioBlob);
            reader.onloadend = function() {
                var base64data = reader.result.split(',')[1];
                window.recordedAudioData = {
                    mimeType: mimeType,
                    base64Data: base64data
                };
                
                logToConsole('Audio converted to base64. Triggering Gemini generation...');
                if (typeof handleGenerate === 'function') {
                    handleGenerate();
                }
            };
        };
        
        mediaRecorder.start();
        
    } catch (e) {
        logToConsole('Failed to start MediaRecorder: ' + e.message);
        isListening = false;
        updateVoiceUI();
    }
}

function stopMediaRecorderListening() {
    if (!isListening || !mediaRecorder) return;
    try {
        mediaRecorder.stop();
        playVoiceBeep(440, 0.12); // Lower pitch beep for deactivation
    } catch (e) {
        logToConsole('Failed to stop MediaRecorder: ' + e.message);
    }
}

function setupSilenceDetection(stream) {
    try {
        var AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) return;
        
        audioContextForSilence = new AudioContextClass();
        analyserForSilence = audioContextForSilence.createAnalyser();
        analyserForSilence.fftSize = 512;
        
        streamSourceForSilence = audioContextForSilence.createMediaStreamSource(stream);
        streamSourceForSilence.connect(analyserForSilence);
        
        var bufferLength = analyserForSilence.frequencyBinCount;
        var dataArray = new Float32Array(bufferLength);
        
        var silenceStart = null;
        var silenceThreshold = 0.015; // Noise threshold
        
        function checkSilence() {
            if (!isListening) return;
            
            analyserForSilence.getFloatTimeDomainData(dataArray);
            
            var sum = 0;
            for (var i = 0; i < bufferLength; i++) {
                sum += dataArray[i] * dataArray[i];
            }
            var rms = Math.sqrt(sum / bufferLength);
            
            if (rms < silenceThreshold) {
                if (silenceStart === null) {
                    silenceStart = Date.now();
                } else if (Date.now() - silenceStart > 2000) { // 2 seconds of silence
                    logToConsole('Silence detected. Automatically stopping recording.');
                    stopListening();
                    return;
                }
            } else {
                silenceStart = null;
            }
            
            silenceDetectionInterval = setTimeout(checkSilence, 100);
        }
        
        silenceDetectionInterval = setTimeout(checkSilence, 100);
    } catch (e) {
        logToConsole('Silence detection failed to initialize: ' + e.message);
    }
}

function cleanupSilenceDetection() {
    if (silenceDetectionInterval) {
        clearTimeout(silenceDetectionInterval);
        silenceDetectionInterval = null;
    }
    if (streamSourceForSilence) {
        try {
            streamSourceForSilence.disconnect();
        } catch (e) {}
        streamSourceForSilence = null;
    }
    if (audioContextForSilence) {
        try {
            audioContextForSilence.close();
        } catch (e) {}
        audioContextForSilence = null;
    }
    analyserForSilence = null;
}

/**
 * Parses and processes transcribed speech. Checks for stop words,
 * inserts command into promptInput, and automatically triggers query.
 * @param {string} text - The transcribed speech text.
 */
function processSpeechResult(text) {
    var lowerText = text.toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "").trim();
    var stops = STOP_WORDS[voiceLanguage] || [];
    
    // Check if the input matches any stop word
    for (var i = 0; i < stops.length; i++) {
        if (lowerText === stops[i]) {
            logToConsole('Stop word detected: "' + stops[i] + '". Aborting continuous cycle.');
            stopContinuousDialog();
            
            var stopResponse = {
                'RU': 'Остановлено',
                'UA': 'Зупинено',
                'EN': 'Stopped'
            }[voiceLanguage];
            
            speakTextQuietly(stopResponse);
            return;
        }
    }
    
    // Set input value and run generate
    var promptInput = document.getElementById('promptInput');
    if (promptInput) {
        promptInput.value = text;
        
        // Auto trigger submit
        if (typeof handleGenerate === 'function') {
            handleGenerate();
        }
    }
}

/**
 * Starts Speech Recognition if it is not already running.
 */
function startListening() {
    // If speaking, wait for speech to finish first
    if (isSpeaking) {
        logToConsole('Delaying listening because speech synthesis is speaking.');
        return;
    }
    
    if (isListening) return;
    
    if (!recognition && !voiceFallbackActive) {
        if (!initSpeechRecognition()) return;
    }
    
    if (voiceFallbackActive) {
        startMediaRecorderListening();
    } else {
        // Set the language dynamically based on active selection
        recognition.lang = LANG_CODES[voiceLanguage];
        
        try {
            recognition.start();
        } catch (e) {
            logToConsole('Failed to start SpeechRecognition: ' + e.message);
        }
    }
}

/**
 * Stops Speech Recognition.
 */
function stopListening() {
    if (!isListening) return;
    if (voiceFallbackActive) {
        stopMediaRecorderListening();
    } else {
        if (!recognition) return;
        try {
            recognition.stop();
            playVoiceBeep(440, 0.12); // Lower pitch beep for deactivation
        } catch (e) {
            logToConsole('Failed to stop SpeechRecognition: ' + e.message);
        }
    }
}

/**
 * Synthesizes speech to speak short local statuses quietly without continuous triggers.
 * @param {string} text - Message to speak.
 */
function speakTextQuietly(text) {
    if (!window.speechSynthesis) return;
    
    window.speechSynthesis.cancel();
    var utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = LANG_CODES[voiceLanguage];
    
    var voices = window.speechSynthesis.getVoices();
    var langPrefix = LANG_CODES[voiceLanguage];
    for (var i = 0; i < voices.length; i++) {
        if (voices[i].lang.indexOf(langPrefix) === 0) {
            utterance.voice = voices[i];
            break;
        }
    }
    
    window.speechSynthesis.speak(utterance);
}

/**
 * Strips markdown markup, headings, list markers, and Javascript code blocks
 * from text responses before Speech Synthesis, ensuring clean speech.
 * @param {string} text - The raw response markdown text.
 * @returns {string} Clean conversational text.
 */
function cleanTextForVoice(text) {
    // Remove markdown code blocks
    var clean = text.replace(/```[\s\S]*?```/g, '');
    // Remove inline code ticks
    clean = clean.replace(/`([^`]+)`/g, '$1');
    // Remove markdown links but keep text
    clean = clean.replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1');
    // Remove headers, list indicators, bold, italic characters
    clean = clean.replace(/[#*_\-]/g, ' ');
    // Normalize spacing
    clean = clean.replace(/\s+/g, ' ');
    return clean.trim();
}

/**
 * Splits text into segments containing either only Latin characters (with digits and space)
 * or non-Latin characters, so they can be spoken by the appropriate voices.
 * @param {string} text - Message to segment.
 * @returns {Array<{text: string, isLatin: boolean}>} Array of text segments.
 */
function segmentTextByLanguage(text) {
    if (!text) return [];
    
    // Split by captures of English words/phrases (continuous Latin letters/numbers/spaces)
    var parts = text.split(/([a-zA-Z][a-zA-Z0-9\s'’\-\.,!\?]*[a-zA-Z0-9]|[a-zA-Z]+)/g);
    var segments = [];
    
    for (var i = 0; i < parts.length; i++) {
        var part = parts[i];
        if (!part) continue;
        
        var trimmed = part.trim();
        if (!trimmed) continue;
        
        // A segment is Latin if it contains English letters
        var isLatin = /[a-zA-Z]/.test(trimmed);
        
        segments.push({
            text: trimmed,
            isLatin: isLatin
        });
    }
    
    return segments;
}

/**
 * Reads a generated response text out loud, automatically filtering code blocks.
 * Supports mixed Russian/Ukrainian/English language sentences using text segmentation.
 * If voiceContinuous is active, restarts listening when finished.
 * @param {string} text - Response markdown text.
 */
function speakResponse(text) {
    if (!window.speechSynthesis) return;
    
    // Stop any active recognition to prevent speaking into the microphone
    if (isListening) {
        stopListening();
    }
    
    window.speechSynthesis.cancel();
    if (continuousRestartTimeout) {
        clearTimeout(continuousRestartTimeout);
    }
    
    var cleanText = cleanTextForVoice(text);
    if (!cleanText) {
        // If there's no speech content (e.g. code only), skip and restart listening if continuous
        if (voiceContinuous) {
            continuousRestartTimeout = setTimeout(function() {
                startListening();
            }, 600);
        }
        return;
    }
    
    var segments = segmentTextByLanguage(cleanText);
    if (segments.length === 0) {
        if (voiceContinuous) {
            continuousRestartTimeout = setTimeout(function() {
                startListening();
            }, 600);
        }
        return;
    }
    
    var voices = window.speechSynthesis.getVoices();
    var nativeLangPrefix = LANG_CODES[voiceLanguage];
    var englishLangPrefix = 'en-US';
    
    // Find voices
    var nativeVoice = null;
    var englishVoice = null;
    
    for (var i = 0; i < voices.length; i++) {
        var v = voices[i];
        if (!nativeVoice && v.lang.indexOf(nativeLangPrefix) === 0) {
            nativeVoice = v;
        }
        if (!englishVoice && v.lang.indexOf(englishLangPrefix) === 0) {
            englishVoice = v;
        }
    }
    
    // Fallbacks
    if (!nativeVoice && voices.length > 0) {
        nativeVoice = voices[0];
    }
    if (!englishVoice) {
        englishVoice = nativeVoice;
    }
    
    isSpeaking = true;
    logToConsole('Speech synthesis starting queue of ' + segments.length + ' segments.');
    
    segments.forEach(function(segment, index) {
        var utterance = new SpeechSynthesisUtterance(segment.text);
        
        // Select voice and language
        if (segment.isLatin) {
            utterance.lang = 'en-US';
            utterance.voice = englishVoice;
        } else {
            utterance.lang = LANG_CODES[voiceLanguage];
            utterance.voice = nativeVoice;
        }
        
        // Manage state updates on the boundary utterances
        if (index === 0) {
            utterance.onstart = function() {
                isSpeaking = true;
                logToConsole('Speech synthesis speaking response...');
            };
        }
        
        // Handle end/error on the final segment of the queue
        if (index === segments.length - 1) {
            utterance.onend = function() {
                isSpeaking = false;
                logToConsole('Speech synthesis completed.');
                
                // In continuous mode, restart listening after a slight buffer delay
                if (voiceContinuous) {
                    continuousRestartTimeout = setTimeout(function() {
                        startListening();
                    }, 600);
                }
            };
            
            utterance.onerror = function(e) {
                logToConsole('Speech synthesis error on last segment: ' + e.error);
                isSpeaking = false;
                
                if (voiceContinuous) {
                    continuousRestartTimeout = setTimeout(function() {
                        startListening();
                    }, 600);
                }
            };
        } else {
            // Intermediate segment error handling
            utterance.onerror = function(e) {
                logToConsole('Speech synthesis error on segment ' + index + ': ' + e.error);
            };
        }
        
        window.speechSynthesis.speak(utterance);
    });
}

/**
 * Completely disables the continuous dialogue mode and stops speaking/listening.
 */
function stopContinuousDialog() {
    voiceContinuous = false;
    if (continuousRestartTimeout) {
        clearTimeout(continuousRestartTimeout);
        continuousRestartTimeout = null;
    }
    
    if (isListening) {
        stopListening();
    }
    
    if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
    }
    isSpeaking = false;
    
    updateVoiceUI();
    logToConsole('Continuous hands-free dialog disabled.');
}

/**
 * Toggles the main Speech Recognition listening state.
 */
function toggleVoiceInput() {
    if (isListening) {
        // If they click to turn off while listening, also cancel continuous mode
        if (voiceContinuous) {
            stopContinuousDialog();
        } else {
            stopListening();
        }
    } else {
        // If speaking, interrupt speech synthesis
        if (window.speechSynthesis && window.speechSynthesis.speaking) {
            window.speechSynthesis.cancel();
            isSpeaking = false;
        }
        startListening();
    }
}

/**
 * Toggles the Continuous Dialogue Mode.
 */
function toggleContinuousMode() {
    voiceContinuous = !voiceContinuous;
    logToConsole('Continuous Dialogue Mode toggled: ' + voiceContinuous);
    
    if (voiceContinuous) {
        showToast('Голосовой авто-ответ включен');
        // Instantly start listening if idle
        if (!isListening && !isSpeaking) {
            startListening();
        }
    } else {
        showToast('Голосовой авто-ответ выключен');
        stopContinuousDialog();
    }
    updateVoiceUI();
}

/**
 * Cycles the selected input/output language: RU -> UA -> EN -> RU.
 */
function cycleVoiceLanguage() {
    if (voiceLanguage === 'RU') {
        voiceLanguage = 'UA';
    } else if (voiceLanguage === 'UA') {
        voiceLanguage = 'EN';
    } else {
        voiceLanguage = 'RU';
    }
    
    showToast('Язык озвучивания: ' + voiceLanguage);
    logToConsole('Voice language changed to: ' + voiceLanguage);
    
    // Play sound in the new language to verify voice availability
    var confirmationPhrases = {
        'RU': 'Слушаю вас',
        'UA': 'Слухаю вас',
        'EN': 'I am listening'
    };
    
    speakTextQuietly(confirmationPhrases[voiceLanguage]);
    updateVoiceUI();
}

/**
 * Updates UI buttons state based on current voice properties.
 */
function updateVoiceUI() {
    var micBtn = document.getElementById('voiceInputBtn');
    var loopBtn = document.getElementById('voiceContinuousBtn');
    var langBtn = document.getElementById('voiceLangBtn');
    var promptInput = document.getElementById('promptInput');
    
    if (micBtn) {
        if (isListening) {
            micBtn.classList.add('listening');
            micBtn.title = 'Stop listening';
        } else {
            micBtn.classList.remove('listening');
            micBtn.title = 'Start Voice Input';
        }
    }
    
    if (loopBtn) {
        if (voiceContinuous) {
            loopBtn.classList.add('active');
            loopBtn.title = 'Disable Continuous Dialog';
        } else {
            loopBtn.classList.remove('active');
            loopBtn.title = 'Enable Continuous Dialog';
        }
    }
    
    if (langBtn) {
        langBtn.textContent = voiceLanguage;
    }
    
    if (promptInput) {
        if (isListening) {
            var listeningPlaceholders = {
                'RU': '🎙️ Слушаю вас... Говорите',
                'UA': '🎙️ Слухаю вас... Говоріть',
                'EN': '🎙️ Listening... Speak now'
            };
            promptInput.placeholder = listeningPlaceholders[voiceLanguage] || '🎙️ Listening...';
        } else {
            promptInput.placeholder = 'E.g.: Create composition "Intro", add a shape layer with a glowing red circle...';
        }
    }
}

/**
 * Binds DOM event listeners for voice controls.
 */
function initVoiceControl() {
    logToConsole('Initializing voice controls...');
    
    var micBtn = document.getElementById('voiceInputBtn');
    var loopBtn = document.getElementById('voiceContinuousBtn');
    var langBtn = document.getElementById('voiceLangBtn');
    
    if (micBtn) {
        micBtn.addEventListener('click', toggleVoiceInput);
    }
    
    if (loopBtn) {
        loopBtn.addEventListener('click', toggleContinuousMode);
    }
    
    if (langBtn) {
        langBtn.addEventListener('click', cycleVoiceLanguage);
    }
    
    // Make sure voices are loaded by speech engine (Chrome loads them asynchronously)
    if (window.speechSynthesis && typeof window.speechSynthesis.getVoices === 'function') {
        window.speechSynthesis.getVoices();
    }
    
    updateVoiceUI();
}
