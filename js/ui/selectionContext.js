/**
 * @file ui/selectionContext.js
 * @description Handles drag-and-drop from After Effects, selection queries,
 *              and automatic reference context chips injection.
 * 
 * Depends on: CSInterface.js, ui/console.js (logToConsole, setStatus)
 */

/**
 * Startup loading: hot-reloads the host.jsx script into After Effects to bypass memory caching issues.
 */
function initHostJsxHotReload() {
    try {
        var extensionDir = csInterface.getSystemPath(SystemPath.EXTENSION);
        var hostJsxPath = extensionDir + '/jsx/host.jsx';
        var evalCommand = '$.evalFile("' + hostJsxPath + '")';
        
        csInterface.evalScript(evalCommand, function (res) {
            logToConsole('ExtendScript host.jsx loaded and cached successfully.');
        });
    } catch (e) {
        logToConsole('Hot reload initialization notice: ' + e.message);
    }
}

/**
 * Queries active composition and selected layers/project items from After Effects,
 * then renders them as high-fidelity context chips.
 */
function injectSelectionContext() {
    setStatus('Querying AE selection...', true);
    logToConsole('Querying selection state from After Effects...');

    csInterface.evalScript('getSelectedContext()', function (result) {
        try {
            var data = JSON.parse(result);
            if (!data.success) {
                logToConsole('ExtendScript Context Query Error: ' + data.error);
                setStatus('Context query failed.', false);
                return;
            }

            var addedCount = 0;

            // 1. Process active composition
            if (data.comp) {
                var compChip = {
                    id: 'comp_' + data.comp.name,
                    name: 'Comp: ' + data.comp.name,
                    icon: '🎥',
                    details: 'Composition (' + data.comp.width + 'x' + data.comp.height + ', ' + data.comp.frameRate + 'fps, ' + data.comp.duration.toFixed(1) + 's)'
                };
                if (addContextItem(compChip)) addedCount++;
            }

            // 2. Process selected layers
            if (data.selectedLayers && data.selectedLayers.length > 0) {
                for (var i = 0; i < data.selectedLayers.length; i++) {
                    var layer = data.selectedLayers[i];
                    var icon = '🎥';
                    if (layer.type === 'TextLayer') icon = '📝';
                    else if (layer.type === 'SolidLayer') icon = '📦';
                    else if (layer.type === 'ShapeLayer') icon = '📐';
                    else if (layer.type === 'CameraLayer') icon = '📹';
                    else if (layer.type === 'LightLayer') icon = '💡';

                    var layerChip = {
                        id: 'layer_' + layer.index + '_' + layer.name,
                        name: 'Layer ' + layer.index + ': ' + layer.name,
                        icon: icon,
                        details: layer.type + ' at index ' + layer.index
                    };
                    if (addContextItem(layerChip)) addedCount++;
                }
            }

            // 3. Process selected project items
            if (data.selectedProjectItems && data.selectedProjectItems.length > 0) {
                for (var j = 0; j < data.selectedProjectItems.length; j++) {
                    var item = data.selectedProjectItems[j];
                    var itemChip = {
                        id: 'proj_' + item.name,
                        name: 'Project Item: ' + item.name,
                        icon: '📁',
                        details: 'Project panel item type ' + item.typeName
                    };
                    if (addContextItem(itemChip)) addedCount++;
                }
            }

            if (addedCount > 0) {
                logToConsole('Added ' + addedCount + ' active AE context elements as interactive chips.');
                renderContextChips();
            } else {
                logToConsole('No new layers, active comps, or project items selected.');
                alert('Пожалуйста, выберите композицию, слои на таймлайне или элементы в панели Project перед привязкой.');
            }
            setStatus('Ready.', false);

        } catch (e) {
            logToConsole('Context JSON Parsing Error. Raw output: ' + result);
            setStatus('Ready.', false);
        }
    });
}

/**
 * Safely adds a chip to the global `attachedContextItems` array if it does not already exist.
 * 
 * @param {Object} item - Context chip data.
 * @returns {boolean} True if added, false if duplicate.
 */
function addContextItem(item) {
    var exists = attachedContextItems.some(function (existing) {
        return existing.id === item.id;
    });
    if (!exists) {
        attachedContextItems.push(item);
        return true;
    }
    return false;
}

/**
 * Re-renders the premium context chips inside `#contextChipsContainer`.
 * Hides the container if empty.
 */
function renderContextChips() {
    var container = document.getElementById('contextChipsContainer');
    if (!container) return;

    container.innerHTML = '';
    if (attachedContextItems.length === 0) {
        container.classList.add('hidden');
        return;
    }

    container.classList.remove('hidden');

    attachedContextItems.forEach(function (item, index) {
        var chip = document.createElement('div');
        chip.className = 'context-chip';
        chip.title = item.details;

        var iconSpan = document.createElement('span');
        iconSpan.className = 'context-chip-icon';
        iconSpan.textContent = item.icon;

        var nameSpan = document.createElement('span');
        nameSpan.textContent = item.name;

        var deleteBtn = document.createElement('button');
        deleteBtn.className = 'context-chip-delete';
        deleteBtn.innerHTML = '&times;';
        deleteBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            removeContextItem(index);
        });

        chip.appendChild(iconSpan);
        chip.appendChild(nameSpan);
        chip.appendChild(deleteBtn);
        container.appendChild(chip);
    });
}

/**
 * Removes a context chip by index and re-renders.
 * 
 * @param {number} index
 */
function removeContextItem(index) {
    attachedContextItems.splice(index, 1);
    renderContextChips();
    logToConsole('Removed context reference item.');
}
