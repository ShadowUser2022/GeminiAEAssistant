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
                if (selLayers.length > 0) {
                    selectedLayersData = "[";
                    for (var i = 0; i < selLayers.length; i++) {
                        var layer = selLayers[i];
                        var layerType = "AVLayer";
                        if (layer instanceof TextLayer) layerType = "TextLayer";
                        else if (layer instanceof CameraLayer) layerType = "CameraLayer";
                        else if (layer instanceof LightLayer) layerType = "LightLayer";
                        else if (layer.source && layer.source instanceof SolidSource) layerType = "SolidLayer";
                        else if (layer instanceof ShapeLayer) layerType = "ShapeLayer";
                        
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
            
            var selProjItems = app.project.selectedItems;
            var selectedProjectItemsData = "[]";
            if (selProjItems.length > 0) {
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

})();
