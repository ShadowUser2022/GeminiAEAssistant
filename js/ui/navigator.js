/**
 * @file ui/navigator.js
 * @description Manages visual navigation between After Effects compositions,
 *              pre-compositions, and timeline layers.
 * 
 * Depends on: CSInterface.js, ui/console.js (logToConsole, setStatus)
 */

// Stack tracking for navigated compositions
var navigationBreadcrumbs = [];

/**
 * Initializes the Navigator UI listeners and triggers initial sync.
 */
function initNavigator() {
    logToConsole('Initializing AE Panel Navigator module...');
    
    // Bind click event to custom Sync button if it exists
    var syncBtn = document.getElementById('syncNavigatorBtn');
    if (syncBtn) {
        syncBtn.addEventListener('click', syncAEProjectNavigator);
    }
    
    // Bind to the crosshair context injection too to auto-refresh navigation
    var injectBtn = document.getElementById('injectContextBtn');
    if (injectBtn) {
        injectBtn.addEventListener('click', function() {
            // Auto sync navigator shortly after context bind
            setTimeout(syncAEProjectNavigator, 300);
        });
    }

    // Trigger initial project navigation mapping
    syncAEProjectNavigator();
}

/**
 * Helper to escape quotes for JSX strings.
 */
function escapeJSXString(str) {
    if (!str) return '';
    return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Queries After Effects project tree and updates the navigation DOM.
 */
function syncAEProjectNavigator() {
    var container = document.getElementById('navigatorPanel');
    if (!container || container.classList.contains('hidden')) {
        // If navigator is not visible, don't waste cycles unless forced
    }
    
    setStatus('Syncing project navigator...', true);
    logToConsole('Querying composition and project hierarchy...');

    csInterface.evalScript('getProjectNavigationTree()', function (result) {
        setStatus('Ready.', false);
        try {
            var data = JSON.parse(result);
            if (!data.success) {
                logToConsole('Navigator Query Error: ' + data.error);
                return;
            }

            renderBreadcrumbs(data.activeCompName);
            renderActiveCompTree(data.activeCompName, data.preComps);
            renderProjectCompsList(data.projectComps, data.activeCompName);

        } catch (e) {
            logToConsole('Navigator JSON Parse Error. Raw response: ' + result);
        }
    });
}

/**
 * Renders the navigation path/breadcrumbs.
 * 
 * @param {string|null} activeCompName
 */
function renderBreadcrumbs(activeCompName) {
    var crumbsContainer = document.getElementById('navBreadcrumbs');
    if (!crumbsContainer) return;

    crumbsContainer.innerHTML = '';

    // Root node
    var rootItem = document.createElement('span');
    rootItem.className = 'breadcrumb-item root';
    rootItem.innerHTML = '📁 Project';
    rootItem.addEventListener('click', function() {
        // Re-sync on root click
        syncAEProjectNavigator();
    });
    crumbsContainer.appendChild(rootItem);

    if (activeCompName && activeCompName !== 'null') {
        // Separator
        var separator = document.createElement('span');
        separator.className = 'breadcrumb-separator';
        separator.textContent = '>';
        crumbsContainer.appendChild(separator);

        // Active comp tag
        var compItem = document.createElement('span');
        compItem.className = 'breadcrumb-item active-comp-tag';
        compItem.innerHTML = '🎥 ' + activeCompName;
        crumbsContainer.appendChild(compItem);
        
        // Update breadcrumb stack tracker if name changed
        if (navigationBreadcrumbs.indexOf(activeCompName) === -1) {
            navigationBreadcrumbs.push(activeCompName);
        }
    }
}

/**
 * Renders list of pre-compositions and layers inside the active composition.
 */
function renderActiveCompTree(activeCompName, preComps) {
    var treeContainer = document.getElementById('navActiveCompTree');
    if (!treeContainer) return;

    treeContainer.innerHTML = '';

    if (!activeCompName || activeCompName === 'null') {
        treeContainer.innerHTML = '<div class="nav-empty-msg">No active composition selected in AE.</div>';
        return;
    }

    var treeHeader = document.createElement('div');
    treeHeader.className = 'tree-section-header';
    treeHeader.textContent = 'Nested Pre-Compositions (' + preComps.length + ')';
    treeContainer.appendChild(treeHeader);

    if (preComps.length === 0) {
        var emptyMsg = document.createElement('div');
        emptyMsg.className = 'tree-empty-node';
        emptyMsg.textContent = 'No nested precomp layers inside this composition.';
        treeContainer.appendChild(emptyMsg);
        return;
    }

    var list = document.createElement('ul');
    list.className = 'tree-list';

    preComps.forEach(function (preComp) {
        var li = document.createElement('li');
        li.className = 'tree-item comp-node';
        li.title = 'Double click to open pre-comp in viewer';

        var icon = document.createElement('span');
        icon.className = 'tree-item-icon';
        icon.textContent = '🎥';

        var label = document.createElement('span');
        label.className = 'tree-item-label';
        label.textContent = 'L' + preComp.index + ': ' + preComp.name;

        var badge = document.createElement('span');
        badge.className = 'tree-item-badge';
        badge.textContent = 'Pre-comp';

        var focusBtn = document.createElement('button');
        focusBtn.className = 'tree-item-action-btn';
        focusBtn.innerHTML = '🔍 Focus';
        focusBtn.title = 'Select this precomp layer on timeline';
        focusBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            focusLayerOnTimeline(activeCompName, preComp.index);
        });

        li.appendChild(icon);
        li.appendChild(label);
        li.appendChild(badge);
        li.appendChild(focusBtn);

        // Click on precomp switches active comp to that precomp
        li.addEventListener('dblclick', function() {
            navigateToComposition(preComp.compName);
        });

        list.appendChild(li);
    });

    treeContainer.appendChild(list);
}

/**
 * Renders all project compositions as a quick-select list to jump across them.
 */
function renderProjectCompsList(projectComps, activeCompName) {
    var listContainer = document.getElementById('navProjectComps');
    if (!listContainer) return;

    listContainer.innerHTML = '';

    var header = document.createElement('div');
    header.className = 'tree-section-header';
    header.textContent = 'All Compositions (' + projectComps.length + ')';
    listContainer.appendChild(header);

    var list = document.createElement('ul');
    list.className = 'tree-list project-comps-list';

    projectComps.forEach(function (compName) {
        var li = document.createElement('li');
        li.className = 'tree-item project-comp-node';
        if (compName === activeCompName) {
            li.classList.add('active');
        }

        var icon = document.createElement('span');
        icon.className = 'tree-item-icon';
        icon.textContent = '🎬';

        var label = document.createElement('span');
        label.className = 'tree-item-label';
        label.textContent = compName;

        li.appendChild(icon);
        li.appendChild(label);

        li.addEventListener('click', function() {
            navigateToComposition(compName);
        });

        list.appendChild(li);
    });

    listContainer.appendChild(list);
}

/**
 * Programmatically tells AE to focus/open a composition.
 * 
 * @param {string} compName
 */
function navigateToComposition(compName) {
    if (!compName) return;
    setStatus('Switching comp...', true);
    logToConsole('Switching active composition to: ' + compName);
    
    var script = 'switchActiveCompositionByName("' + escapeJSXString(compName) + '")';
    script = '$.evalFile("' + csInterface.getSystemPath(SystemPath.EXTENSION) + '/jsx/host.jsx"); ' + script;
    csInterface.evalScript(script, function(result) {
        setStatus('Ready.', false);
        try {
            var data = JSON.parse(result);
            if (!data.success) {
                logToConsole('Switch Composition Error: ' + data.error);
                alert('Не удалось открыть композицию: ' + data.error);
            } else {
                // Instantly re-sync navigation visual map
                setTimeout(syncAEProjectNavigator, 200);
            }
        } catch(e) {
            logToConsole('Switch Composition Callback Parse Error: ' + result);
        }
    });
}

/**
 * Programmatically deselects all layers and selects a specific layer index inside After Effects.
 * 
 * @param {string} compName
 * @param {number} layerIndex
 */
function focusLayerOnTimeline(compName, layerIndex) {
    if (!compName || !layerIndex) return;
    setStatus('Focusing layer...', true);
    logToConsole('Focusing layer index ' + layerIndex + ' in ' + compName);
    
    var script = 'selectAndFocusLayer("' + escapeJSXString(compName) + '", ' + layerIndex + ')';
    script = '$.evalFile("' + csInterface.getSystemPath(SystemPath.EXTENSION) + '/jsx/host.jsx"); ' + script;
    csInterface.evalScript(script, function(result) {
        setStatus('Ready.', false);
        try {
            var data = JSON.parse(result);
            if (!data.success) {
                logToConsole('Focus Layer Error: ' + data.error);
            } else {
                showToast('Слой ' + layerIndex + ' сфокусирован на таймлайне');
            }
        } catch(e) {
            logToConsole('Focus Layer Callback Parse Error: ' + result);
        }
    });
}
