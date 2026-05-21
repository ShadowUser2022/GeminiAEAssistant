/**
 * @file ui/voice.js
 * @description Voice control manager for Speech-to-Text (STT) and Text-to-Speech (TTS).
 *
 * Implements browser SpeechRecognition and SpeechSynthesis, custom audio cues,
 * stop-word processing, and continuous dialogue loops.
 *
 * Shared globals: handleGenerate (main.js), logToConsole (ui/console.js), showToast (main.js)
 */

var voiceContinuous = false;
var isListening = false;
var isSpeaking = false;

var recognition = null;
var currentUtterance = null;
var continuousRestartTimeout = null;

var mediaRecorder = null;
var audioChunks = [];
var audioStream = null;
var voiceFallbackActive = true;
window.recordedAudioData = null;
var silenceDetectionInterval = null;
var audioContextForSilence = null;
var analyserForSilence = null;
var streamSourceForSilence = null;

// Combined stop words across Russian, Ukrainian, and English
var ALL_STOP_WORDS = [
    'стоп', 'хватит', 'достаточно', 'перестань', 'остановись', 'пауза',
    'досить', 'зупинись', 'зупинка',
    'stop', 'enough', 'cancel', 'pause', 'exit', 'quit', 'shut up'
];

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
 * Legacy-aware wrapper to request the audio stream.
 * Handles Chromium Secure Context restrictions on file:// schemes.
 */
async function getAudioStream() {
    var nav = window.navigator;
    var getUserMedia = (nav.mediaDevices && nav.mediaDevices.getUserMedia && nav.mediaDevices.getUserMedia.bind(nav.mediaDevices)) ||
                       (nav.getUserMedia && nav.getUserMedia.bind(nav)) ||
                       (nav.webkitGetUserMedia && nav.webkitGetUserMedia.bind(nav)) ||
                       (nav.mozGetUserMedia && nav.mozGetUserMedia.bind(nav)) ||
                       (nav.msGetUserMedia && nav.msGetUserMedia.bind(nav));
                       
    if (!getUserMedia) {
        throw new Error('getUserMedia is not supported in this browser environment');
    }
    
    if (nav.mediaDevices && nav.mediaDevices.getUserMedia) {
        return await nav.mediaDevices.getUserMedia({ audio: true });
    }
    
    return new Promise(function(resolve, reject) {
        getUserMedia({ audio: true }, resolve, reject);
    });
}

/**
 * Detects the language of a text segment dynamically.
 * @param {string} text
 * @returns {string} Language code
 */
function detectSegmentLang(text) {
    if (/[a-zA-Z]/.test(text)) {
        return 'en-US';
    }
    if (/[іІїЇєЄґҐ]/.test(text)) {
        return 'uk-UA';
    }
    if (/[ыЫэЭъЪёЁ]/.test(text)) {
        return 'ru-RU';
    }
    return 'ru-RU';
}

async function startMediaRecorderListening() {
    if (isListening) return;
    audioChunks = [];
    
    try {
        audioStream = await getAudioStream();
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
    
    // Check if the input matches any stop word across all languages
    for (var i = 0; i < ALL_STOP_WORDS.length; i++) {
        if (lowerText === ALL_STOP_WORDS[i]) {
            logToConsole('Stop word detected: "' + ALL_STOP_WORDS[i] + '". Aborting continuous cycle.');
            stopContinuousDialog();
            
            var stopResponse = 'Stopped';
            if (ALL_STOP_WORDS[i] === 'стоп' || ALL_STOP_WORDS[i] === 'досить' || ALL_STOP_WORDS[i] === 'перестань') {
                stopResponse = 'Остановлено';
            }
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
    if (isSpeaking) {
        logToConsole('Delaying listening because speech synthesis is speaking.');
        return;
    }
    
    if (isListening) return;
    
    if (voiceFallbackActive) {
        startMediaRecorderListening();
    }
}

/**
 * Stops Speech Recognition.
 */
function stopListening() {
    if (!isListening) return;
    if (voiceFallbackActive) {
        stopMediaRecorderListening();
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
    var langCode = detectSegmentLang(text);
    utterance.lang = langCode;
    
    var voices = window.speechSynthesis.getVoices();
    var targetVoice = null;
    
    for (var i = 0; i < voices.length; i++) {
        var v = voices[i];
        if (v.lang.toLowerCase().indexOf(langCode.substring(0, 2)) === 0) {
            targetVoice = v;
            break;
        }
    }
    if (targetVoice) {
        utterance.voice = targetVoice;
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
    var clean = text.replace(/<voice>[\s\S]*?<\/voice>/g, '');
    clean = clean.replace(/```[\s\S]*?```/g, '');
    clean = clean.replace(/`([^`]+)`/g, '$1');
    clean = clean.replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1');
    clean = clean.replace(/[#*_\-]/g, ' ');
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
    
    var parts = text.split(/([a-zA-Z][a-zA-Z0-9\s'’\-\.,!\?]*[a-zA-Z0-9]|[a-zA-Z]+)/g);
    var segments = [];
    
    for (var i = 0; i < parts.length; i++) {
        var part = parts[i];
        if (!part) continue;
        
        var trimmed = part.trim();
        if (!trimmed) continue;
        
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
    
    if (isListening) {
        stopListening();
    }
    
    window.speechSynthesis.cancel();
    if (continuousRestartTimeout) {
        clearTimeout(continuousRestartTimeout);
    }
    
    var cleanText = cleanTextForVoice(text);
    if (!cleanText) {
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
    var ruVoice = null;
    var ukVoice = null;
    var enVoice = null;
    
    for (var i = 0; i < voices.length; i++) {
        var v = voices[i];
        var lang = v.lang.toLowerCase();
        if (!ruVoice && (lang.indexOf('ru') === 0 || lang.indexOf('rus') === 0)) {
            ruVoice = v;
        }
        if (!ukVoice && (lang.indexOf('uk') === 0 || lang.indexOf('ukr') === 0)) {
            ukVoice = v;
        }
        if (!enVoice && (lang.indexOf('en') === 0 || lang.indexOf('eng') === 0)) {
            enVoice = v;
        }
    }
    
    function getVoiceForLang(langCode) {
        if (langCode === 'en-US') {
            return enVoice || ruVoice || ukVoice || voices[0];
        } else if (langCode === 'uk-UA') {
            return ukVoice || ruVoice || enVoice || voices[0];
        } else {
            return ruVoice || ukVoice || enVoice || voices[0];
        }
    }
    
    isSpeaking = true;
    logToConsole('Speech synthesis starting queue of ' + segments.length + ' segments.');
    
    segments.forEach(function(segment, index) {
        var utterance = new SpeechSynthesisUtterance(segment.text);
        var langCode = detectSegmentLang(segment.text);
        
        utterance.lang = langCode;
        utterance.voice = getVoiceForLang(langCode);
        
        if (index === 0) {
            utterance.onstart = function() {
                isSpeaking = true;
                logToConsole('Speech synthesis speaking response...');
            };
        }
        
        if (index === segments.length - 1) {
            utterance.onend = function() {
                isSpeaking = false;
                logToConsole('Speech synthesis completed.');
                
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
        if (voiceContinuous) {
            stopContinuousDialog();
        } else {
            stopListening();
        }
    } else {
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
 * Updates UI buttons state based on current voice properties.
 */
function updateVoiceUI() {
    var micBtn = document.getElementById('voiceInputBtn');
    var loopBtn = document.getElementById('voiceContinuousBtn');
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
    
    if (promptInput) {
        if (isListening) {
            promptInput.placeholder = '🎙️ Слушаю... / Listening...';
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
    
    if (micBtn) {
        micBtn.addEventListener('click', toggleVoiceInput);
    }
    
    if (loopBtn) {
        loopBtn.addEventListener('click', toggleContinuousMode);
    }
    
    if (window.speechSynthesis && typeof window.speechSynthesis.getVoices === 'function') {
        window.speechSynthesis.getVoices();
    }
    
    updateVoiceUI();
}
