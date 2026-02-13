"use strict";
figma.showUI(__html__, { width: 360, height: 400 });
figma.ui.onmessage = async (msg) => {
    if (msg.type === 'execute-command' && msg.command) {
        const cmd = msg.command;
        try {
            const result = await executeCommand(cmd);
            figma.ui.postMessage({ type: 'command-result', id: cmd.id, success: true, result });
        }
        catch (err) {
            figma.ui.postMessage({ type: 'command-result', id: cmd.id, success: false, error: err.message || String(err) });
        }
    }
    else if (msg.type === 'image-data' && msg.imageData) {
        const bytes = new Uint8Array(msg.imageData.bytes);
        const image = figma.createImage(bytes);
        figma.ui.postMessage({ type: 'image-ready', tempKey: msg.imageData.tempKey, hash: image.hash });
    }
};
async function executeCommand(cmd) {
    switch (cmd.type) {
        case 'create_nodes':
            return handleCreateNodes(cmd.payload);
        case 'update_nodes':
            return handleUpdateNodes(cmd.payload);
        case 'delete_nodes':
            return handleDeleteNodes(cmd.payload);
        case 'get_node_info':
            return handleGetNodeInfo(cmd.payload);
        case 'get_nodes_info':
            return handleGetNodesInfo(cmd.payload);
        case 'list_pages':
            return handleListPages();
        case 'set_current_page':
            return handleSetCurrentPage(cmd.payload);
        case 'get_annotations':
            return handleGetAnnotations(cmd.payload);
        case 'get_reactions':
            return handleGetReactions(cmd.payload);
        case 'get_selection':
            return handleGetSelection();
        case 'scan_annotations':
            return handleScanAnnotations(cmd.payload);
        case 'export_node':
            return handleExportNode(cmd.payload);
        case 'get_styles':
            return handleGetStyles(cmd.payload);
        case 'get_variables':
            return handleGetVariables();
        case 'import_component':
            return handleImportComponent(cmd.payload);
        case 'create_from_svg':
            return handleCreateFromSvg(cmd.payload);
        case 'find_nodes':
            return handleFindNodes(cmd.payload);
        case 'group_nodes':
            return handleGroupNodes(cmd.payload);
        case 'ungroup_nodes':
            return handleUngroupNodes(cmd.payload);
        case 'list_fonts':
            return handleListFonts();
        default:
            throw new Error(`Unknown command type: ${cmd.type}`);
    }
}
const FALLBACK_FONT = { family: 'Inter', style: 'Regular' };
const FALLBACK_FONT_KEY = `${FALLBACK_FONT.family}|${FALLBACK_FONT.style}`;
async function loadFonts(fonts, warnings) {
    const loaded = new Set();
    for (const font of fonts) {
        const key = `${font.family}|${font.style}`;
        if (loaded.has(key))
            continue;
        try {
            await figma.loadFontAsync(font);
            loaded.add(key);
        }
        catch (_e) {
            warnings.push(`Font ${font.family} ${font.style} not available, falling back to Inter Regular`);
            if (!loaded.has(FALLBACK_FONT_KEY)) {
                await figma.loadFontAsync(FALLBACK_FONT);
                loaded.add(FALLBACK_FONT_KEY);
            }
        }
    }
    if (!loaded.has(FALLBACK_FONT_KEY)) {
        await figma.loadFontAsync(FALLBACK_FONT);
        loaded.add(FALLBACK_FONT_KEY);
    }
    return loaded;
}
async function handleCreateNodes(payload) {
    const { parentNodeId, nodes } = payload;
    const idMapping = {};
    const warnings = [];
    let parent;
    if (parentNodeId) {
        const found = figma.getNodeById(parentNodeId);
        if (!found)
            throw new Error(`Parent node ${parentNodeId} not found`);
        if (!('children' in found))
            throw new Error(`Node ${parentNodeId} cannot have children`);
        parent = found;
    }
    else {
        parent = figma.currentPage;
    }
    const loadedFonts = await loadFonts(collectFonts(nodes), warnings);
    for (const nodeDef of nodes) {
        try {
            await createNodeRecursive(nodeDef, parent, idMapping, warnings, loadedFonts);
        }
        catch (err) {
            warnings.push(`Failed to create node ${nodeDef.tempId || nodeDef.name || nodeDef.type}: ${err.message}`);
        }
    }
    const createdNodes = Object.values(idMapping)
        .map(id => figma.getNodeById(id))
        .filter(Boolean);
    if (createdNodes.length > 0) {
        figma.viewport.scrollAndZoomIntoView(createdNodes);
    }
    return { idMapping, warnings: warnings.length > 0 ? warnings : undefined };
}
function collectFonts(nodes) {
    const fonts = [];
    for (const node of nodes) {
        if (node.type === 'TEXT') {
            fonts.push({
                family: node.fontFamily || FALLBACK_FONT.family,
                style: node.fontStyle || FALLBACK_FONT.style,
            });
        }
        if (node.children) {
            fonts.push(...collectFonts(node.children));
        }
    }
    return fonts;
}
async function createNodeRecursive(def, parent, idMapping, warnings, loadedFonts) {
    let node;
    switch (def.type) {
        case 'FRAME':
            node = figma.createFrame();
            break;
        case 'RECTANGLE':
            node = figma.createRectangle();
            break;
        case 'ELLIPSE':
            node = figma.createEllipse();
            break;
        case 'TEXT':
            node = figma.createText();
            break;
        case 'LINE':
            node = figma.createLine();
            break;
        case 'COMPONENT':
            node = figma.createComponent();
            break;
        case 'INSTANCE': {
            if (def.componentId) {
                const comp = figma.getNodeById(def.componentId);
                if (comp && comp.type === 'COMPONENT') {
                    node = comp.createInstance();
                }
                else {
                    warnings.push(`Component ${def.componentId} not found, creating frame instead`);
                    node = figma.createFrame();
                }
            }
            else {
                warnings.push('INSTANCE without componentId, creating frame instead');
                node = figma.createFrame();
            }
            break;
        }
        case 'VECTOR':
            node = figma.createVector();
            break;
        default:
            warnings.push(`Unknown node type "${def.type}", creating frame instead`);
            node = figma.createFrame();
    }
    parent.appendChild(node);
    applyNodeProperties(node, def, warnings, loadedFonts);
    if (def.tempId) {
        idMapping[def.tempId] = node.id;
    }
    if (def.children && 'children' in node) {
        for (const childDef of def.children) {
            try {
                await createNodeRecursive(childDef, node, idMapping, warnings, loadedFonts);
            }
            catch (err) {
                warnings.push(`Failed to create child ${childDef.tempId || childDef.name || childDef.type}: ${err.message}`);
            }
        }
    }
    return node;
}
function applyNodeProperties(node, def, warnings, loadedFonts) {
    if (def.name !== undefined)
        node.name = def.name;
    if (def.x !== undefined)
        node.x = def.x;
    if (def.y !== undefined)
        node.y = def.y;
    if ('resize' in node) {
        if (def.width !== undefined && def.height !== undefined) {
            node.resize(def.width, def.height);
        }
        else if (def.width !== undefined) {
            node.resize(def.width, node.height);
        }
        else if (def.height !== undefined) {
            node.resize(node.width, def.height);
        }
    }
    if (def.rotation !== undefined && 'rotation' in node)
        node.rotation = def.rotation;
    if (def.opacity !== undefined && 'opacity' in node)
        node.opacity = def.opacity;
    if (def.visible !== undefined)
        node.visible = def.visible;
    if (def.locked !== undefined)
        node.locked = def.locked;
    if (def.fills !== undefined && 'fills' in node) {
        node.fills = buildPaints(def.fills);
    }
    if (def.strokes !== undefined && 'strokes' in node) {
        node.strokes = buildPaints(def.strokes);
    }
    if (def.strokeWeight !== undefined && 'strokeWeight' in node) {
        node.strokeWeight = def.strokeWeight;
    }
    if (def.strokeAlign !== undefined && 'strokeAlign' in node) {
        node.strokeAlign = def.strokeAlign;
    }
    if (def.effects !== undefined && 'effects' in node) {
        node.effects = buildEffects(def.effects);
    }
    if ('cornerRadius' in node) {
        const rect = node;
        if (def.cornerRadius !== undefined)
            rect.cornerRadius = def.cornerRadius;
        if (def.topLeftRadius !== undefined)
            rect.topLeftRadius = def.topLeftRadius;
        if (def.topRightRadius !== undefined)
            rect.topRightRadius = def.topRightRadius;
        if (def.bottomLeftRadius !== undefined)
            rect.bottomLeftRadius = def.bottomLeftRadius;
        if (def.bottomRightRadius !== undefined)
            rect.bottomRightRadius = def.bottomRightRadius;
    }
    if (def.clipsContent !== undefined && 'clipsContent' in node) {
        node.clipsContent = def.clipsContent;
    }
    if ('layoutMode' in node) {
        const frame = node;
        if (def.layoutMode !== undefined)
            frame.layoutMode = def.layoutMode;
        if (def.primaryAxisAlignItems !== undefined)
            frame.primaryAxisAlignItems = def.primaryAxisAlignItems;
        if (def.counterAxisAlignItems !== undefined)
            frame.counterAxisAlignItems = def.counterAxisAlignItems;
        if (def.paddingTop !== undefined)
            frame.paddingTop = def.paddingTop;
        if (def.paddingRight !== undefined)
            frame.paddingRight = def.paddingRight;
        if (def.paddingBottom !== undefined)
            frame.paddingBottom = def.paddingBottom;
        if (def.paddingLeft !== undefined)
            frame.paddingLeft = def.paddingLeft;
        if (def.itemSpacing !== undefined)
            frame.itemSpacing = def.itemSpacing;
        if (def.primaryAxisSizingMode !== undefined)
            frame.primaryAxisSizingMode = def.primaryAxisSizingMode;
        if (def.counterAxisSizingMode !== undefined)
            frame.counterAxisSizingMode = def.counterAxisSizingMode;
    }
    if (def.layoutGrow !== undefined && 'layoutGrow' in node) {
        node.layoutGrow = def.layoutGrow;
    }
    if (def.layoutAlign !== undefined && 'layoutAlign' in node) {
        node.layoutAlign = def.layoutAlign;
    }
    if (def.constraints !== undefined && 'constraints' in node) {
        node.constraints = {
            horizontal: def.constraints.horizontal,
            vertical: def.constraints.vertical,
        };
    }
    if (node.type === 'TEXT') {
        applyTextProperties(node, def, warnings, loadedFonts);
    }
}
function applyTextProperties(textNode, def, warnings, loadedFonts) {
    const fontFamily = def.fontFamily || FALLBACK_FONT.family;
    const fontStyle = def.fontStyle || FALLBACK_FONT.style;
    const fontKey = `${fontFamily}|${fontStyle}`;
    if (loadedFonts.has(fontKey)) {
        textNode.fontName = { family: fontFamily, style: fontStyle };
    }
    else {
        textNode.fontName = FALLBACK_FONT;
        if (def.fontFamily) {
            warnings.push(`Using Inter Regular instead of ${fontFamily} ${fontStyle}`);
        }
    }
    if (def.characters !== undefined)
        textNode.characters = def.characters;
    if (def.fontSize !== undefined)
        textNode.fontSize = def.fontSize;
    if (def.textAlignHorizontal !== undefined)
        textNode.textAlignHorizontal = def.textAlignHorizontal;
    if (def.textAlignVertical !== undefined)
        textNode.textAlignVertical = def.textAlignVertical;
    if (def.letterSpacing !== undefined)
        textNode.letterSpacing = { value: def.letterSpacing, unit: 'PIXELS' };
    if (def.textDecoration !== undefined)
        textNode.textDecoration = def.textDecoration;
    if (def.textCase !== undefined)
        textNode.textCase = def.textCase;
    if (def.lineHeight !== undefined) {
        if (typeof def.lineHeight === 'number') {
            textNode.lineHeight = { value: def.lineHeight, unit: 'PIXELS' };
        }
        else if (def.lineHeight.unit === 'AUTO') {
            textNode.lineHeight = { unit: 'AUTO' };
        }
        else {
            textNode.lineHeight = { value: def.lineHeight.value, unit: def.lineHeight.unit };
        }
    }
}
function buildPaints(defs) {
    return defs.map(d => {
        var _a, _b, _c, _d, _f;
        if (d.type === 'SOLID') {
            return {
                type: 'SOLID',
                color: d.color || { r: 0, g: 0, b: 0 },
                opacity: (_a = d.opacity) !== null && _a !== void 0 ? _a : 1,
                visible: (_b = d.visible) !== null && _b !== void 0 ? _b : true,
            };
        }
        if (d.type === 'IMAGE' && d.imageRef) {
            return {
                type: 'IMAGE',
                scaleMode: 'FILL',
                imageHash: d.imageRef,
                visible: (_c = d.visible) !== null && _c !== void 0 ? _c : true,
            };
        }
        if (d.type === 'GRADIENT_LINEAR' && d.gradientStops) {
            return {
                type: 'GRADIENT_LINEAR',
                gradientStops: d.gradientStops.map(s => ({
                    position: s.position,
                    color: { r: s.color.r, g: s.color.g, b: s.color.b, a: s.color.a },
                })),
                gradientTransform: (d.gradientTransform || [[1, 0, 0], [0, 1, 0]]),
                visible: (_d = d.visible) !== null && _d !== void 0 ? _d : true,
            };
        }
        // Fallback: transparent solid
        return {
            type: 'SOLID',
            color: { r: 0, g: 0, b: 0 },
            opacity: 0,
            visible: (_f = d.visible) !== null && _f !== void 0 ? _f : true,
        };
    });
}
function buildEffects(defs) {
    return defs.map((d) => {
        var _a, _b;
        const visible = (_a = d.visible) !== null && _a !== void 0 ? _a : true;
        if (d.type === 'DROP_SHADOW' || d.type === 'INNER_SHADOW') {
            return {
                type: d.type,
                visible,
                radius: d.radius,
                color: d.color || { r: 0, g: 0, b: 0, a: 0.25 },
                offset: d.offset || { x: 0, y: 4 },
                spread: (_b = d.spread) !== null && _b !== void 0 ? _b : 0,
                blendMode: 'NORMAL',
            };
        }
        const blurType = d.type === 'BACKGROUND_BLUR' ? 'BACKGROUND_BLUR' : 'LAYER_BLUR';
        return { type: blurType, visible, radius: d.radius, blurType: 'NORMAL' };
    });
}
async function handleUpdateNodes(payload) {
    const results = [];
    const warnings = [];
    const fontDefs = payload.updates
        .filter(upd => upd.properties.fontFamily || upd.properties.fontStyle)
        .map(upd => ({
        family: upd.properties.fontFamily || FALLBACK_FONT.family,
        style: upd.properties.fontStyle || FALLBACK_FONT.style,
    }));
    const loadedFonts = await loadFonts(fontDefs, warnings);
    for (const upd of payload.updates) {
        try {
            const node = figma.getNodeById(upd.nodeId);
            if (!node) {
                results.push({ nodeId: upd.nodeId, success: false, error: 'Node not found' });
                continue;
            }
            if (!('type' in node) || node.type === 'DOCUMENT' || node.type === 'PAGE') {
                results.push({ nodeId: upd.nodeId, success: false, error: 'Cannot update document/page nodes' });
                continue;
            }
            applyNodeProperties(node, upd.properties, warnings, loadedFonts);
            results.push({ nodeId: upd.nodeId, success: true });
        }
        catch (err) {
            results.push({ nodeId: upd.nodeId, success: false, error: err.message });
        }
    }
    return { results, warnings: warnings.length > 0 ? warnings : undefined };
}
function handleDeleteNodes(payload) {
    const results = [];
    for (const nodeId of payload.nodeIds) {
        try {
            const node = figma.getNodeById(nodeId);
            if (!node) {
                results.push({ nodeId, success: false, error: 'Node not found' });
                continue;
            }
            if (node.type === 'DOCUMENT' || node.type === 'PAGE') {
                results.push({ nodeId, success: false, error: 'Cannot delete document/page nodes' });
                continue;
            }
            node.remove();
            results.push({ nodeId, success: true });
        }
        catch (err) {
            results.push({ nodeId, success: false, error: err.message });
        }
    }
    return { results };
}
function isMixed(value) {
    return typeof value === 'symbol';
}
function safeValue(value, mixedLabel = 'MIXED') {
    return isMixed(value) ? mixedLabel : value;
}
function collectNodeInfo(node) {
    const info = {
        id: node.id,
        type: node.type,
        name: node.name,
    };
    if ('x' in node)
        info.x = node.x;
    if ('y' in node)
        info.y = node.y;
    if ('width' in node)
        info.width = node.width;
    if ('height' in node)
        info.height = node.height;
    if ('rotation' in node)
        info.rotation = node.rotation;
    if ('opacity' in node)
        info.opacity = node.opacity;
    if ('visible' in node)
        info.visible = node.visible;
    if ('fills' in node)
        info.fills = safeValue(node.fills);
    if ('strokes' in node)
        info.strokes = safeValue(node.strokes);
    if ('strokeWeight' in node)
        info.strokeWeight = safeValue(node.strokeWeight);
    if ('effects' in node)
        info.effects = safeValue(node.effects);
    if ('cornerRadius' in node)
        info.cornerRadius = safeValue(node.cornerRadius);
    if ('layoutMode' in node)
        info.layoutMode = node.layoutMode;
    if ('children' in node) {
        info.children = node.children.map((c) => ({
            id: c.id,
            type: c.type,
            name: c.name,
        }));
    }
    if (node.type === 'TEXT') {
        const t = node;
        info.characters = t.characters;
        info.fontSize = safeValue(t.fontSize);
        info.fontName = safeValue(t.fontName);
        if (isMixed(t.fontSize) || isMixed(t.fontName) || isMixed(t.fills)) {
            info.segments = extractTextSegments(t);
        }
    }
    return info;
}
function extractTextSegments(textNode) {
    const fields = ['fontName', 'fontSize', 'fills', 'textDecoration', 'textCase', 'lineHeight', 'letterSpacing'];
    const segments = textNode.getStyledTextSegments(fields);
    return segments.map(seg => ({
        start: seg.start,
        end: seg.end,
        characters: seg.characters,
        fontName: seg.fontName,
        fontSize: seg.fontSize,
        fills: seg.fills,
        textDecoration: seg.textDecoration,
        textCase: seg.textCase,
        lineHeight: seg.lineHeight,
        letterSpacing: seg.letterSpacing,
    }));
}
function handleGetNodeInfo(payload) {
    const node = requireNode(payload.nodeId);
    return collectNodeInfo(node);
}
function handleGetNodesInfo(payload) {
    const results = [];
    for (const nodeId of payload.nodeIds) {
        try {
            const node = figma.getNodeById(nodeId);
            if (!node) {
                results.push({ nodeId, success: false, error: 'Node not found' });
                continue;
            }
            results.push({ nodeId, success: true, data: collectNodeInfo(node) });
        }
        catch (err) {
            results.push({ nodeId, success: false, error: err.message });
        }
    }
    return { results };
}
function handleListPages() {
    return {
        pages: figma.root.children.map(page => ({
            id: page.id,
            name: page.name,
            isCurrent: page === figma.currentPage,
        })),
    };
}
function handleSetCurrentPage(payload) {
    const page = figma.root.children.find(p => p.id === payload.pageId);
    if (!page)
        throw new Error(`Page ${payload.pageId} not found`);
    figma.currentPage = page;
    return { success: true, pageName: page.name };
}
function extractNodeArray(node, property) {
    if (property in node) {
        const value = node[property];
        if (Array.isArray(value))
            return value;
    }
    return [];
}
function requireNode(nodeId) {
    const node = figma.getNodeById(nodeId);
    if (!node)
        throw new Error(`Node ${nodeId} not found`);
    return node;
}
function handleGetAnnotations(payload) {
    const node = requireNode(payload.nodeId);
    return {
        id: node.id,
        name: node.name,
        type: node.type,
        annotations: extractNodeArray(node, 'annotations'),
    };
}
function handleGetReactions(payload) {
    const node = requireNode(payload.nodeId);
    return {
        id: node.id,
        name: node.name,
        type: node.type,
        reactions: extractNodeArray(node, 'reactions'),
    };
}
function handleGetSelection() {
    const selection = figma.currentPage.selection;
    if (selection.length === 0) {
        return { nodes: [], message: 'Nothing selected' };
    }
    return {
        nodes: selection.map(node => (Object.assign(Object.assign({}, collectNodeInfo(node)), { annotations: extractNodeArray(node, 'annotations'), reactions: extractNodeArray(node, 'reactions') }))),
    };
}
function handleScanAnnotations(payload) {
    const root = payload.nodeId ? requireNode(payload.nodeId) : figma.currentPage;
    const results = [];
    function walk(node) {
        const summary = nodeAnnotationSummary(node);
        if (summary.annotations.length > 0 || summary.reactions.length > 0) {
            results.push(summary);
        }
        if ('children' in node) {
            for (const child of node.children) {
                walk(child);
            }
        }
    }
    walk(root);
    return {
        rootId: root.id,
        rootName: root.name,
        totalFound: results.length,
        nodes: results,
    };
}
function nodeAnnotationSummary(node) {
    return {
        id: node.id,
        name: node.name,
        type: node.type,
        annotations: extractNodeArray(node, 'annotations'),
        reactions: extractNodeArray(node, 'reactions'),
    };
}
async function handleExportNode(payload) {
    const node = requireNode(payload.nodeId);
    if (!('exportAsync' in node))
        throw new Error(`Node ${payload.nodeId} does not support export`);
    const format = (payload.format || 'PNG').toUpperCase();
    const scale = payload.scale || 1;
    const settings = format === 'SVG'
        ? { format: 'SVG' }
        : format === 'PDF'
            ? { format: 'PDF' }
            : { format: format === 'JPG' ? 'JPG' : 'PNG', constraint: { type: 'SCALE', value: scale } };
    const bytes = await node.exportAsync(settings);
    const base64 = figma.base64Encode(bytes);
    return {
        nodeId: node.id,
        name: node.name,
        format,
        size: bytes.length,
        data: base64,
    };
}
function handleGetStyles(payload) {
    var _a;
    const filter = (_a = payload.type) === null || _a === void 0 ? void 0 : _a.toUpperCase();
    const results = {};
    if (!filter || filter === 'PAINT') {
        results.paintStyles = figma.getLocalPaintStyles().map(s => ({
            id: s.id,
            name: s.name,
            type: 'PAINT',
            paints: s.paints,
        }));
    }
    if (!filter || filter === 'TEXT') {
        results.textStyles = figma.getLocalTextStyles().map(s => ({
            id: s.id,
            name: s.name,
            type: 'TEXT',
            fontSize: s.fontSize,
            fontName: s.fontName,
            lineHeight: s.lineHeight,
            letterSpacing: s.letterSpacing,
            textDecoration: s.textDecoration,
            textCase: s.textCase,
        }));
    }
    if (!filter || filter === 'EFFECT') {
        results.effectStyles = figma.getLocalEffectStyles().map(s => ({
            id: s.id,
            name: s.name,
            type: 'EFFECT',
            effects: s.effects,
        }));
    }
    if (!filter || filter === 'GRID') {
        results.gridStyles = figma.getLocalGridStyles().map(s => ({
            id: s.id,
            name: s.name,
            type: 'GRID',
            layoutGrids: s.layoutGrids,
        }));
    }
    return results;
}
function handleGetVariables() {
    const collections = figma.variables.getLocalVariableCollections().map(c => ({
        id: c.id,
        name: c.name,
        modes: c.modes,
        variableIds: c.variableIds,
    }));
    const variables = figma.variables.getLocalVariables().map(v => ({
        id: v.id,
        name: v.name,
        resolvedType: v.resolvedType,
        valuesByMode: v.valuesByMode,
    }));
    return { collections, variables };
}
async function handleImportComponent(payload) {
    const component = await figma.importComponentByKeyAsync(payload.key);
    return {
        id: component.id,
        name: component.name,
        type: component.type,
        width: component.width,
        height: component.height,
    };
}
function handleCreateFromSvg(payload) {
    const node = figma.createNodeFromSvg(payload.svg);
    if (payload.x !== undefined)
        node.x = payload.x;
    if (payload.y !== undefined)
        node.y = payload.y;
    figma.currentPage.appendChild(node);
    figma.viewport.scrollAndZoomIntoView([node]);
    return {
        id: node.id,
        name: node.name,
        type: node.type,
        width: node.width,
        height: node.height,
    };
}
function handleFindNodes(payload) {
    var _a, _b;
    const maxResults = payload.maxResults || 100;
    const offset = payload.offset || 0;
    const limit = offset + maxResults;
    const root = payload.parentNodeId
        ? requireNode(payload.parentNodeId)
        : figma.currentPage;
    if (!('findAll' in root))
        throw new Error(`Node ${root.id} does not support findAll`);
    const queryLower = (_a = payload.query) === null || _a === void 0 ? void 0 : _a.toLowerCase();
    const typeFilter = (_b = payload.type) === null || _b === void 0 ? void 0 : _b.toUpperCase();
    const allMatches = [];
    let hasMore = false;
    root.findAll((node) => {
        if (allMatches.length > limit) {
            hasMore = true;
            return false;
        }
        if (typeFilter && node.type !== typeFilter)
            return false;
        if (queryLower && !node.name.toLowerCase().includes(queryLower))
            return false;
        allMatches.push({ id: node.id, name: node.name, type: node.type });
        return false;
    });
    if (allMatches.length > limit)
        hasMore = true;
    const matches = allMatches.slice(offset, offset + maxResults);
    return { matches, totalFound: allMatches.length, offset, hasMore };
}
function handleGroupNodes(payload) {
    if (!payload.nodeIds || payload.nodeIds.length < 1) {
        throw new Error('At least one node ID is required to group');
    }
    const nodes = [];
    for (const id of payload.nodeIds) {
        const node = figma.getNodeById(id);
        if (!node)
            throw new Error(`Node ${id} not found`);
        if (node.type === 'DOCUMENT' || node.type === 'PAGE')
            throw new Error(`Cannot group document/page nodes`);
        nodes.push(node);
    }
    const parent = nodes[0].parent;
    if (!parent || !('children' in parent))
        throw new Error('Cannot determine parent for grouping');
    const group = figma.group(nodes, parent);
    return {
        id: group.id,
        name: group.name,
        type: group.type,
        childCount: group.children.length,
    };
}
function handleUngroupNodes(payload) {
    const node = figma.getNodeById(payload.nodeId);
    if (!node)
        throw new Error(`Node ${payload.nodeId} not found`);
    if (node.type !== 'GROUP')
        throw new Error(`Node ${payload.nodeId} is not a group (type: ${node.type})`);
    const group = node;
    const childIds = group.children.map(c => ({ id: c.id, name: c.name, type: c.type }));
    figma.ungroup(group);
    return { ungrouped: true, children: childIds };
}
async function handleListFonts() {
    const fonts = await figma.listAvailableFontsAsync();
    return {
        fonts: fonts.map(f => ({
            family: f.fontName.family,
            style: f.fontName.style,
        })),
        totalCount: fonts.length,
    };
}
