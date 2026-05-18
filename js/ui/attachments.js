/**
 * @file ui/attachments.js
 * @description File attachment management — select, paste, preview, remove.
 *
 * Manages the `attachedFiles` array (defined in main.js) and updates the
 * visual thumbnail strip above the prompt textarea.
 *
 * Depends on: config.js     (MAX_ATTACHED_FILES, MAX_IMAGE_DIM, IMAGE_QUALITY)
 *             ui/console.js (logToConsole)
 *
 * Shared globals read/written: attachedFiles (main.js)
 */

// ─── Image Processing ─────────────────────────────────────────────────────────

/**
 * Resizes an image to fit within MAX_IMAGE_DIM and converts it to JPEG
 * for compatibility and reduced payload size. Then pushes the result to
 * the `attachedFiles` array and re-renders the preview strip.
 *
 * Falls back to the original data if canvas operations fail.
 *
 * @param {string}   name       - Display name shown in console logs.
 * @param {string}   mimeType   - Original MIME type (e.g. 'image/png').
 * @param {string}   rawBase64  - Base64-encoded image data (no data-URI prefix).
 * @param {Function} [onComplete] - Optional callback(success: boolean).
 */
function processAndAttachImage(name, mimeType, rawBase64, onComplete) {
    var img = new Image();

    img.onload = function () {
        try {
            var canvas = document.createElement('canvas');
            var width  = img.width;
            var height = img.height;

            // Downscale proportionally if either dimension exceeds the limit
            if (width > MAX_IMAGE_DIM || height > MAX_IMAGE_DIM) {
                if (width > height) {
                    height = Math.round((height * MAX_IMAGE_DIM) / width);
                    width  = MAX_IMAGE_DIM;
                } else {
                    width  = Math.round((width * MAX_IMAGE_DIM) / height);
                    height = MAX_IMAGE_DIM;
                }
            }

            canvas.width  = width;
            canvas.height = height;
            var ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);

            // Convert to JPEG: enforces 8-bit RGB and reduces payload size
            var compressedBase64 = canvas.toDataURL('image/jpeg', IMAGE_QUALITY).split(',')[1];

            if (attachedFiles.length >= MAX_ATTACHED_FILES) {
                logToConsole('Warning: attachment limit reached (' + MAX_ATTACHED_FILES + '). File not attached.');
                alert('You can attach a maximum of ' + MAX_ATTACHED_FILES + ' files.');
                if (onComplete) onComplete(false);
                return;
            }

            attachedFiles.push({ name: name, mimeType: 'image/jpeg', base64Data: compressedBase64 });
            renderPreviews();
            logToConsole('Image successfully compressed and converted to 8-bit JPEG.');
            if (onComplete) onComplete(true);

        } catch (e) {
            // Canvas failed (e.g. cross-origin taint) — use original data as fallback
            logToConsole('Canvas image processing error: ' + e.message);
            if (attachedFiles.length >= MAX_ATTACHED_FILES) {
                if (onComplete) onComplete(false);
                return;
            }
            attachedFiles.push({ name: name, mimeType: mimeType, base64Data: rawBase64 });
            renderPreviews();
            if (onComplete) onComplete(true);
        }
    };

    img.onerror = function () {
        logToConsole('Error loading image for processing.');
        if (onComplete) onComplete(false);
    };

    img.src = 'data:' + mimeType + ';base64,' + rawBase64;
}

// ─── File Input Handler ───────────────────────────────────────────────────────

/**
 * Handles the `change` event of the hidden `<input type="file">` element.
 * Reads each selected image file as a Base64 data-URI and passes it to
 * `processAndAttachImage`. Resets the input so the same file can be re-selected.
 *
 * @param {Event} e - The native file-input change event.
 */
function handleFileSelect(e) {
    var files = Array.from(e.target.files);

    if (attachedFiles.length + files.length > MAX_ATTACHED_FILES) {
        logToConsole('Warning: attachment limit reached (' + MAX_ATTACHED_FILES + ').');
        alert('You can attach a maximum of ' + MAX_ATTACHED_FILES + ' files.');
        return;
    }

    files.forEach(function (file) {
        if (!file.type.startsWith('image/')) {
            logToConsole('Error: Only images are supported.');
            return;
        }
        var reader    = new FileReader();
        reader.onload = function (event) {
            var base64Data = event.target.result.split(',')[1].replace(/[\r\n\s]+/g, '');
            processAndAttachImage(file.name, file.type, base64Data);
        };
        reader.readAsDataURL(file);
    });

    // Reset so the same file can be chosen again
    e.target.value = '';
}

// ─── Preview Strip ────────────────────────────────────────────────────────────

/**
 * Re-renders the thumbnail strip above the prompt textarea.
 * Hides the strip container when there are no attachments.
 */
function renderPreviews() {
    var container = document.getElementById('previewContainer');
    if (!container) return;
    container.innerHTML = '';

    if (attachedFiles.length === 0) {
        container.classList.add('hidden');
        return;
    }

    container.classList.remove('hidden');

    attachedFiles.forEach(function (file, index) {
        var item      = document.createElement('div');
        item.className = 'preview-item';

        var img = document.createElement('img');
        img.src = 'data:' + file.mimeType + ';base64,' + file.base64Data;

        var removeBtn       = document.createElement('button');
        removeBtn.className = 'remove-btn';
        removeBtn.innerHTML = '&times;';
        removeBtn.title     = 'Remove';
        removeBtn.addEventListener('click', function () { removeAttachedFile(index); });

        item.appendChild(img);
        item.appendChild(removeBtn);
        container.appendChild(item);
    });
}

/**
 * Removes the attachment at the given index and refreshes the preview strip.
 *
 * @param {number} index - Zero-based index in the `attachedFiles` array.
 */
function removeAttachedFile(index) {
    attachedFiles.splice(index, 1);
    renderPreviews();
}

// ─── Clipboard Paste ──────────────────────────────────────────────────────────

/**
 * Global `paste` event listener that intercepts clipboard images (Ctrl+V / Cmd+V)
 * and attaches them directly without requiring a file-picker dialog.
 * Only handles items whose kind is 'file' and type starts with 'image/'.
 * Processes only the first image found in the clipboard event.
 */
document.addEventListener('paste', function (e) {
    var items = e.clipboardData && e.clipboardData.items;
    if (!items) return;

    for (var i = 0; i < items.length; i++) {
        var item = items[i];
        if (item.kind === 'file' && item.type.startsWith('image/')) {
            e.preventDefault();
            var blob = item.getAsFile();
            if (!blob) continue;

            var reader    = new FileReader();
            reader.onload = function (evt) {
                var base64Data = evt.target.result.split(',')[1].replace(/[\r\n\s]+/g, '');
                var name       = 'Clipboard ' + new Date().toLocaleTimeString();
                processAndAttachImage(name, item.type, base64Data, function (success) {
                    if (success) logToConsole('Image pasted from clipboard.');
                });
            };
            reader.readAsDataURL(blob);
            break; // Only process the first image
        }
    }
});

// ─── Event Listeners ─────────────────────────────────────────────────────────

document.getElementById('attachBtn').addEventListener('click', function () {
    document.getElementById('fileInput').click();
});

document.getElementById('fileInput').addEventListener('change', handleFileSelect);
