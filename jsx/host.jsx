/**
 * @file host.jsx
 * @description ExtendScript layer running inside After Effects.
 * Provides APIs for code evaluation, aspect ratio queries, and footage import.
 */

(function () {
    /**
     * Helper to escape backslashes, double quotes, and control chars for safe manual JSON building.
     * 
     * @param {string} str - Raw string.
     * @returns {string} Escaped string.
     */
    function escapeString(str) {
        if (!str) return "";
        return str.toString()
            .replace(/\\/g, "\\\\")
            .replace(/"/g, "\\\"")
            .replace(/\n/g, "\\n")
            .replace(/\r/g, "\\r")
            .replace(/\t/g, "\\t");
    }

    /**
     * Robust UTF-8 Base64 Decoder.
     * 
     * @param {string} str - Base64-encoded string.
     * @returns {string} Decoded UTF-8 string.
     */
    function decodeBase64(str) {
        var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";
        var bytes = [];
        var i = 0;
        while (i < str.length) {
            var c1 = chars.indexOf(str.charAt(i++));
            var c2 = chars.indexOf(str.charAt(i++));
            var c3 = chars.indexOf(str.charAt(i++));
            var c4 = chars.indexOf(str.charAt(i++));
            var b1 = (c1 << 2) | (c2 >> 4);
            var b2 = ((c2 & 15) << 4) | (c3 >> 2);
            var b3 = ((c3 & 3) << 6) | c4;
            bytes.push(b1);
            if (c3 !== 64) bytes.push(b2);
            if (c4 !== 64) bytes.push(b3);
        }
        var out = "";
        var idx = 0;
        while (idx < bytes.length) {
            var b = bytes[idx++];
            if (b < 0x80) {
                out += String.fromCharCode(b);
            } else if (b < 0xE0) {
                var b2 = bytes[idx++];
                out += String.fromCharCode(((b & 0x1F) << 6) | (b2 & 0x3F));
            } else if (b < 0xF0) {
                var b2 = bytes[idx++];
                var b3 = bytes[idx++];
                out += String.fromCharCode(((b & 0x0F) << 12) | ((b2 & 0x3F) << 6) | (b3 & 0x3F));
            }
        }
        return out;
    }

    /**
     * Evaluates ExtendScript code safely wrapped in a try/catch, returning a JSON status string.
     * 
     * @global
     * @param {string} base64Code - Base64-encoded string containing code.
     * @returns {string} JSON-formatted status string.
     */
    evaluateAIGeneratedCode = function (base64Code) {
        try {
            var decoded = decodeBase64(base64Code);
            var result = eval(decoded);
            return "{\"success\":true}";
        } catch (e) {
            return "{\"success\":false,\"error\":\"" + escapeString(e.toString()) + "\"}";
        }
    };

    /**
     * Gets the aspect ratio of the active composition.
     * 
     * @global
     * @returns {string} E.g., "1920:1080" or "1:1" if none active.
     */
    getActiveCompAspectRatio = function () {
        try {
            var activeComp = app.project.activeItem;
            if (activeComp && activeComp.typeName === "Composition") {
                return activeComp.width + ":" + activeComp.height;
            }
        } catch (e) {
            // ignore and fallback
        }
        return "1:1";
    };

    /**
     * Imports an image file into AE and adds it as a layer fitted to the comp's aspect ratio.
     * 
     * @global
     * @param {string} filePath - Absolute path to the saved file.
     * @returns {string} JSON import status.
     */
    importGeneratedImage = function (filePath) {
        app.beginUndoGroup("Import AI Design Layer");
        try {
            var activeComp = app.project.activeItem;
            if (!activeComp || activeComp.typeName !== "Composition") {
                return "{\"success\":false,\"error\":\"No active composition found to import the image to.\"}";
            }
            
            var importOptions = new ImportOptions(new File(filePath));
            if (!importOptions.canImportAs(ImportAsType.FOOTAGE)) {
                return "{\"success\":false,\"error\":\"File cannot be imported as footage.\"}";
            }
            
            var footageItem = app.project.importFile(importOptions);
            var newLayer = activeComp.layers.add(footageItem);
            
            // Fit to comp aspect ratio proportionally
            var scaleX = (activeComp.width / footageItem.width) * 100;
            var scaleY = (activeComp.height / footageItem.height) * 100;
            var scaleVal = Math.min(scaleX, scaleY);
            newLayer.property("Transform").property("Scale").setValue([scaleVal, scaleVal]);
            
            app.endUndoGroup();
            return "{\"success\":true}";
        } catch (e) {
            app.endUndoGroup();
            return "{\"success\":false,\"error\":\"" + escapeString(e.toString()) + "\"}";
        }
    };

    /**
     * Serializes selected layers and project items to return as a context structure.
     * 
     * @global
     * @returns {string} JSON string of context details.
     */
    getSelectedContext = function () {
        try {
            var activeComp = app.project.activeItem;
            var compData = "null";
            var selectedLayersData = "[]";
            
            if (activeComp && activeComp.typeName === "Composition") {
                compData = "{" +
                    "\"name\":\"" + escapeString(activeComp.name) + "\"," +
                    "\"width\":" + activeComp.width + "," +
                    "\"height\":" + activeComp.height + "," +
                    "\"duration\":" + activeComp.duration + "," +
                    "\"frameRate\":" + activeComp.frameRate +
                "}";
                
                var selLayers = activeComp.selectedLayers;
                if (selLayers && selLayers.length > 0) {
                    selectedLayersData = "[";
                    for (var i = 0; i < selLayers.length; i++) {
                        var layer = selLayers[i];
                        var layerType = "AVLayer";
                        
                        if (layer instanceof TextLayer) {
                            layerType = "TextLayer";
                        } else if (layer instanceof CameraLayer) {
                            layerType = "CameraLayer";
                        } else if (layer instanceof LightLayer) {
                            layerType = "LightLayer";
                        } else if (layer instanceof ShapeLayer) {
                            layerType = "ShapeLayer";
                        } else if (layer.source) {
                            try {
                                if (layer.source.mainSource && (layer.source.mainSource.color || layer.source.mainSource.typeName === "Solid" || (layer.source.mainSource.toString && layer.source.mainSource.toString().indexOf("SolidSource") !== -1))) {
                                    layerType = "SolidLayer";
                                }
                            } catch (e) {
                                // Ignore and keep AVLayer
                            }
                        }
                        
                        selectedLayersData += "{" +
                            "\"name\":\"" + escapeString(layer.name) + "\"," +
                            "\"index\":" + layer.index + "," +
                            "\"type\":\"" + layerType + "\"" +
                        "}";
                        if (i < selLayers.length - 1) selectedLayersData += ",";
                    }
                    selectedLayersData += "]";
                }
            }
            
            var selProjItems = app.project.selection;
            var selectedProjectItemsData = "[]";
            if (selProjItems && selProjItems.length > 0) {
                selectedProjectItemsData = "[";
                for (var j = 0; j < selProjItems.length; j++) {
                    var item = selProjItems[j];
                    selectedProjectItemsData += "{" +
                        "\"name\":\"" + escapeString(item.name) + "\"," +
                        "\"typeName\":\"" + escapeString(item.typeName) + "\"" +
                    "}";
                    if (j < selProjItems.length - 1) selectedProjectItemsData += ",";
                }
                selectedProjectItemsData += "]";
            }
            
            return "{" +
                "\"success\":true," +
                "\"comp\":" + compData + "," +
                "\"selectedLayers\":" + selectedLayersData + "," +
                "\"selectedProjectItems\":" + selectedProjectItemsData +
            "}";
        } catch (e) {
            return "{\"success\":false,\"error\":\"" + escapeString(e.toString()) + "\"}";
        }
    };

    /**
     * Gathers composition and project statistics for Telegram status message.
     * 
     * @global
     * @returns {string} JSON string of AE stats.
     */
    getAECompositionStats = function () {
        try {
            var activeComp = app.project.activeItem;
            var projectName = app.project.file ? app.project.file.name : "Untitled.aep";
            
            if (!activeComp || activeComp.typeName !== "Composition") {
                return "{\"success\":false,\"error\":\"No active composition found.\",\"projectName\":\"" + escapeString(projectName) + "\"}";
            }
            
            return "{" +
                "\"success\":true," +
                "\"projectName\":\"" + escapeString(projectName) + "\"," +
                "\"activeCompName\":\"" + escapeString(activeComp.name) + "\"," +
                "\"width\":" + activeComp.width + "," +
                "\"height\":" + activeComp.height + "," +
                "\"duration\":" + activeComp.duration + "," +
                "\"frameRate\":" + activeComp.frameRate + "," +
                "\"layerCount\":" + activeComp.layers.length +
            "}";
        } catch (e) {
            return "{\"success\":false,\"error\":\"" + escapeString(e.toString()) + "\"}";
        }
    };

    /**
     * Exports the current frame at timeline playhead as a PNG file.
     * 
     * @global
     * @param {string} outputPath - Absolute destination path.
     * @returns {string} Success or error string.
     */
    exportActiveFrameToPath = function (outputPath) {
        try {
            var activeComp = app.project.activeItem;
            if (!activeComp || activeComp.typeName !== "Composition") {
                return "Error: No active composition found.";
            }
            
            var currentTime = activeComp.time;
            // Use OS temp folder to avoid spaces in path and permission restrictions
            var tempFile = new File(Folder.temp.fsName + "/ae_telegram_screen.png");
            if (tempFile.exists) {
                tempFile.remove();
            }
            activeComp.saveFrameToPng(currentTime, tempFile);
            
            if (!tempFile.exists) {
                return "Error: Failed to write PNG frame file to: " + tempFile.fsName;
            }
            return "Success: Frame exported to " + tempFile.fsName;
        } catch (e) {
            return "Error: " + e.toString();
        }
    };

    /**
     * Adds the current active composition to the render queue, sets the output file path to a unique name
     * under the target directory (detecting the extension automatically from the active render settings),
     * and triggers the render.
     * 
     * @global
     * @param {string} targetDirStr - Absolute path to target directory (e.g. macOS Desktop).
     * @returns {string} Success message with actual path, or error string.
     */
    triggerActiveCompRender = function (targetDirStr) {
        try {
            var activeComp = app.project.activeItem;
            if (!activeComp || activeComp.typeName !== "Composition") {
                return "Error: No active composition found.";
            }
            
            // Add to Render Queue
            var rqItem = app.project.renderQueue.items.add(activeComp);
            var outputModule = rqItem.outputModule(1);
            
            // Clean composition name for a safe filename (letters, numbers, spaces, underscores, hyphens, and Cyrillic)
            var compName = activeComp.name;
            var cleanCompName = compName.replace(/[^a-zA-Z0-9_\-\s\u0410-\u042F\u0430-\u044F\u0401\u0451]/g, "_");
            cleanCompName = cleanCompName.replace(/^\s+|\s+$/g, ""); // trim
            if (!cleanCompName) {
                cleanCompName = "render";
            }

            // Determine output extension automatically from AE's default assignment
            var extension = ".mov"; // Fallback
            if (outputModule.file) {
                var aeFileName = outputModule.file.name;
                var dotIndex = aeFileName.lastIndexOf(".");
                if (dotIndex !== -1) {
                    extension = aeFileName.substring(dotIndex);
                }
            }
            
            // Set up target directory Folder object
            var targetFolder = new Folder(targetDirStr);
            if (!targetFolder.exists) {
                if (outputModule.file && outputModule.file.parent) {
                    targetFolder = outputModule.file.parent;
                } else {
                    targetFolder = Folder.desktop;
                }
            }
            
            // Increment file name to avoid overwrite prompt
            var finalFileName = cleanCompName + extension;
            var finalFile = new File(targetFolder.fsName + "/" + finalFileName);
            var counter = 1;
            
            while (finalFile.exists) {
                finalFileName = cleanCompName + "_" + counter + extension;
                finalFile = new File(targetFolder.fsName + "/" + finalFileName);
                counter++;
            }
            
            // Set output path and render
            outputModule.file = finalFile;
            app.project.renderQueue.render();
            
            if (!finalFile.exists) {
                return "Error: Render completed but output file not found on disk.";
            }
            return "Success: Render complete at " + finalFile.fsName;
        } catch (e) {
            return "Error: " + e.toString();
        }
    };

    /**
     * Gathers a list of compositions and nested pre-compositions inside the active composition.
     * Includes try/catch to safely handle camera/light layers that do not support .source.
     * 
     * @global
     * @returns {string} JSON-formatted tree map.
     */
    getProjectNavigationTree = function () {
        try {
            var activeComp = app.project.activeItem;
            var activeCompName = "null";
            var preCompsData = "[]";
            
            if (activeComp && activeComp.typeName === "Composition") {
                activeCompName = "\"" + escapeString(activeComp.name) + "\"";
                
                var preCompsList = [];
                for (var i = 1; i <= activeComp.layers.length; i++) {
                    var layer = activeComp.layers[i];
                    try {
                        if (layer.source && layer.source instanceof CompItem) {
                            preCompsList.push("{" +
                                "\"name\":\"" + escapeString(layer.name) + "\"," +
                                "\"index\":" + layer.index + "," +
                                "\"compName\":\"" + escapeString(layer.source.name) + "\"" +
                            "}");
                        }
                    } catch (layerErr) {
                        // Safe ignore if accessing layer.source throws on non-AVLayer types
                    }
                }
                preCompsData = "[" + preCompsList.join(",") + "]";
            }
            
            var projectComps = [];
            for (var j = 1; j <= app.project.numItems; j++) {
                var item = app.project.item(j);
                if (item instanceof CompItem) {
                    projectComps.push("\"" + escapeString(item.name) + "\"");
                }
            }
            var projectCompsData = "[" + projectComps.join(",") + "]";
            
            return "{" +
                "\"success\":true," +
                "\"activeCompName\":" + activeCompName + "," +
                "\"preComps\":" + preCompsData + "," +
                "\"projectComps\":" + projectCompsData +
            "}";
        } catch (e) {
            return "{\"success\":false,\"error\":\"" + escapeString(e.toString()) + "\"}";
        }
    };

    /**
     * Programmatically switches the active composition in the After Effects viewer.
     * 
     * @global
     * @param {string} compName - The exact composition name to switch to.
     * @returns {string} JSON-formatted success or error.
     */
    switchActiveCompositionByName = function (compName) {
        try {
            for (var i = 1; i <= app.project.numItems; i++) {
                var item = app.project.item(i);
                if (item instanceof CompItem && item.name === compName) {
                    item.openInViewer();
                    return "{\"success\":true}";
                }
            }
            return "{\"success\":false,\"error\":\"Composition not found: " + escapeString(compName) + "\"}";
        } catch (e) {
            return "{\"success\":false,\"error\":\"" + escapeString(e.toString()) + "\"}";
        }
    };

    /**
     * Programmatically opens a composition, deselects other layers, selects the specified layer index, and focuses the timeline.
     * Skips locked layers to prevent ExtendScript errors.
     * 
     * @global
     * @param {string} compName - The composition name.
     * @param {number} layerIndex - The index of the layer to select.
     * @returns {string} JSON-formatted success or error.
     */
    selectAndFocusLayer = function (compName, layerIndex) {
        try {
            var compItem = null;
            for (var i = 1; i <= app.project.numItems; i++) {
                var item = app.project.item(i);
                if (item instanceof CompItem && item.name === compName) {
                    compItem = item;
                    break;
                }
            }
            
            if (!compItem) {
                return "{\"success\":false,\"error\":\"Composition not found: " + escapeString(compName) + "\"}";
            }
            
            compItem.openInViewer();
            
            var layer = compItem.layer(Number(layerIndex));
            if (!layer) {
                return "{\"success\":false,\"error\":\"Layer not found at index: " + layerIndex + "\"}";
            }
            
            // Deselect all non-locked layers
            for (var j = 1; j <= compItem.layers.length; j++) {
                if (!compItem.layers[j].locked) {
                    compItem.layers[j].selected = false;
                }
            }
            
            // Select our target layer if it's not locked
            if (!layer.locked) {
                layer.selected = true;
            }
            
            // Force Timeline window focus
            var timelineCmdId = app.findMenuCommandId("Timeline");
            if (timelineCmdId) {
                app.executeCommand(timelineCmdId);
            }
            
            return "{\"success\":true}";
        } catch (e) {
            return "{\"success\":false,\"error\":\"" + escapeString(e.toString()) + "\"}";
        }
    };

    /**
     * Helper to find the index of a project item.
     */
    function getItemProjectIndex(item) {
        for (var i = 1; i <= app.project.numItems; i++) {
            if (app.project.item(i) === item) {
                return i;
            }
        }
        return -1;
    }

    /**
     * Gathers navigation data for the remote Telegram Bot.
     * Includes active composition, parent compositions, and nested pre-compositions.
     * 
     * @global
     * @returns {string} JSON-formatted navigation details.
     */
    getRemoteNavigationData = function () {
        try {
            var activeComp = app.project.activeItem;
            var activeCompName = "null";
            var activeCompIndex = -1;
            var parentsData = "[]";
            var preCompsData = "[]";
            
            if (activeComp && activeComp.typeName === "Composition") {
                activeCompName = activeComp.name;
                activeCompIndex = getItemProjectIndex(activeComp);
                
                // Find parent compositions (where activeComp is used as precomp)
                var parentsList = [];
                for (var i = 1; i <= app.project.numItems; i++) {
                    var item = app.project.item(i);
                    if (item instanceof CompItem && item !== activeComp) {
                        for (var j = 1; j <= item.layers.length; j++) {
                            try {
                                var layer = item.layers[j];
                                if (layer.source && layer.source === activeComp) {
                                    parentsList.push("{" +
                                        "\"name\":\"" + escapeString(item.name) + "\"," +
                                        "\"index\":" + i +
                                    "}");
                                    break; // Found in this composition, move to next item
                                }
                            } catch (e) {}
                        }
                    }
                }
                parentsData = "[" + parentsList.join(",") + "]";
                
                // Find nested pre-compositions inside the active composition
                var preCompsList = [];
                for (var i = 1; i <= activeComp.layers.length; i++) {
                    try {
                        var layer = activeComp.layers[i];
                        if (layer.source && layer.source instanceof CompItem) {
                            var targetIndex = getItemProjectIndex(layer.source);
                            preCompsList.push("{" +
                                "\"layerName\":\"" + escapeString(layer.name) + "\"," +
                                "\"layerIndex\":" + layer.index + "," +
                                "\"compName\":\"" + escapeString(layer.source.name) + "\"," +
                                "\"compIndex\":" + targetIndex +
                            "}");
                        }
                    } catch (e) {}
                }
                preCompsData = "[" + preCompsList.join(",") + "]";
            }
            
            return "{" +
                "\"success\":true," +
                "\"activeCompName\":\"" + escapeString(activeCompName) + "\"," +
                "\"activeCompIndex\":" + activeCompIndex + "," +
                "\"parents\":" + parentsData + "," +
                "\"preComps\":" + preCompsData +
            "}";
        } catch (e) {
            return "{\"success\":false,\"error\":\"" + escapeString(e.toString()) + "\"}";
        }
    };

    /**
     * Programmatically switches the active composition by project item index.
     * 
     * @global
     * @param {number} itemIndex - Project item index (1-indexed).
     * @returns {string} JSON status.
     */
    switchActiveCompositionByIndex = function (itemIndex) {
        try {
            var item = app.project.item(Number(itemIndex));
            if (item && item instanceof CompItem) {
                item.openInViewer();
                return "{\"success\":true}";
            }
            return "{\"success\":false,\"error\":\"Composition not found at index: \" + itemIndex}";
        } catch (e) {
            return "{\"success\":false,\"error\":\"" + escapeString(e.toString()) + "\"}";
        }
    };

    /**
     * Focuses and selects a specific layer index inside a target composition.
     * Skips locked layers to prevent ExtendScript errors.
     * 
     * @global
     * @param {number} compIndex - Project item index of the composition.
     * @param {number} layerIndex - Layer index (1-indexed).
     * @returns {string} JSON status.
     */
    selectAndFocusLayerByIndex = function (compIndex, layerIndex) {
        try {
            var compItem = app.project.item(Number(compIndex));
            if (!compItem || !(compItem instanceof CompItem)) {
                return "{\"success\":false,\"error\":\"Composition not found at index: \" + compIndex}";
            }
            
            compItem.openInViewer();
            
            var layer = compItem.layer(Number(layerIndex));
            if (!layer) {
                return "{\"success\":false,\"error\":\"Layer not found at index: \" + layerIndex}";
            }
            
            // Deselect all non-locked layers
            for (var j = 1; j <= compItem.layers.length; j++) {
                if (!compItem.layers[j].locked) {
                    compItem.layers[j].selected = false;
                }
            }
            
            // Select the target layer
            if (!layer.locked) {
                layer.selected = true;
            }
            
            // Focus Timeline
            var timelineCmdId = app.findMenuCommandId("Timeline");
            if (timelineCmdId) {
                app.executeCommand(timelineCmdId);
            }
            
            return "{\"success\":true}";
        } catch (e) {
            return "{\"success\":false,\"error\":\"" + escapeString(e.toString()) + "\"}";
        }
    };

})();

