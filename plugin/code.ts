figma.showUI(__html__, { width: 360, height: 400 });

interface DesignNode {
  tempId?: string;
  type: string;
  name?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotation?: number;
  opacity?: number;
  visible?: boolean;
  locked?: boolean;
  fills?: PaintDef[];
  strokes?: PaintDef[];
  strokeWeight?: number;
  strokeAlign?: 'INSIDE' | 'OUTSIDE' | 'CENTER';
  effects?: EffectDef[];
  cornerRadius?: number;
  topLeftRadius?: number;
  topRightRadius?: number;
  bottomLeftRadius?: number;
  bottomRightRadius?: number;
  clipsContent?: boolean;
  layoutMode?: 'NONE' | 'HORIZONTAL' | 'VERTICAL';
  primaryAxisAlignItems?: 'MIN' | 'CENTER' | 'MAX' | 'SPACE_BETWEEN';
  counterAxisAlignItems?: 'MIN' | 'CENTER' | 'MAX' | 'BASELINE';
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  itemSpacing?: number;
  primaryAxisSizingMode?: 'FIXED' | 'AUTO';
  counterAxisSizingMode?: 'FIXED' | 'AUTO';
  layoutGrow?: number;
  layoutAlign?: 'INHERIT' | 'STRETCH' | 'MIN' | 'CENTER' | 'MAX';
  characters?: string;
  fontSize?: number;
  fontFamily?: string;
  fontStyle?: string;
  textAlignHorizontal?: 'LEFT' | 'CENTER' | 'RIGHT' | 'JUSTIFIED';
  textAlignVertical?: 'TOP' | 'CENTER' | 'BOTTOM';
  lineHeight?: number | { value: number; unit: 'PIXELS' | 'PERCENT' | 'AUTO' };
  letterSpacing?: number;
  textDecoration?: 'NONE' | 'UNDERLINE' | 'STRIKETHROUGH';
  textCase?: 'ORIGINAL' | 'UPPER' | 'LOWER' | 'TITLE';
  constraints?: { horizontal: string; vertical: string };
  componentId?: string;
  children?: DesignNode[];
}

interface PaintDef {
  type: string;
  color?: { r: number; g: number; b: number };
  opacity?: number;
  visible?: boolean;
  imageRef?: string; // ImageHash set by ui.html after fetching
  imageUrl?: string;
  gradientStops?: Array<{ position: number; color: { r: number; g: number; b: number; a: number } }>;
  gradientTransform?: number[][];
}

interface EffectDef {
  type: string;
  color?: { r: number; g: number; b: number; a: number };
  offset?: { x: number; y: number };
  radius: number;
  spread?: number;
  visible?: boolean;
}

interface Command {
  id: string;
  type: string;
  payload: any;
}

figma.ui.onmessage = async (msg: { type: string; command?: Command; imageData?: { tempKey: string; bytes: number[] } }) => {
  if (msg.type === 'execute-command' && msg.command) {
    const cmd = msg.command;
    try {
      const result = await executeCommand(cmd);
      figma.ui.postMessage({ type: 'command-result', id: cmd.id, success: true, result });
    } catch (err: any) {
      figma.ui.postMessage({ type: 'command-result', id: cmd.id, success: false, error: err.message || String(err) });
    }
  } else if (msg.type === 'image-data' && msg.imageData) {
    const bytes = new Uint8Array(msg.imageData.bytes);
    const image = figma.createImage(bytes);
    figma.ui.postMessage({ type: 'image-ready', tempKey: msg.imageData.tempKey, hash: image.hash });
  }
};

async function executeCommand(cmd: Command): Promise<unknown> {
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

async function loadFonts(
  fonts: Array<{ family: string; style: string }>,
  warnings: string[],
): Promise<Set<string>> {
  const loaded = new Set<string>();
  for (const font of fonts) {
    const key = `${font.family}|${font.style}`;
    if (loaded.has(key)) continue;
    try {
      await figma.loadFontAsync(font);
      loaded.add(key);
    } catch (_e) {
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

async function handleCreateNodes(payload: { parentNodeId?: string; nodes: DesignNode[] }): Promise<unknown> {
  const { parentNodeId, nodes } = payload;
  const idMapping: Record<string, string> = {};
  const warnings: string[] = [];

  let parent: BaseNode & ChildrenMixin;
  if (parentNodeId) {
    const found = figma.getNodeById(parentNodeId);
    if (!found) throw new Error(`Parent node ${parentNodeId} not found`);
    if (!('children' in found)) throw new Error(`Node ${parentNodeId} cannot have children`);
    parent = found as BaseNode & ChildrenMixin;
  } else {
    parent = figma.currentPage;
  }

  const loadedFonts = await loadFonts(collectFonts(nodes), warnings);

  for (const nodeDef of nodes) {
    try {
      await createNodeRecursive(nodeDef, parent, idMapping, warnings, loadedFonts);
    } catch (err: any) {
      warnings.push(`Failed to create node ${nodeDef.tempId || nodeDef.name || nodeDef.type}: ${err.message}`);
    }
  }

  const createdNodes = Object.values(idMapping)
    .map(id => figma.getNodeById(id))
    .filter(Boolean) as SceneNode[];
  if (createdNodes.length > 0) {
    figma.viewport.scrollAndZoomIntoView(createdNodes);
  }

  return { idMapping, warnings: warnings.length > 0 ? warnings : undefined };
}

function collectFonts(nodes: DesignNode[]): Array<{ family: string; style: string }> {
  const fonts: Array<{ family: string; style: string }> = [];
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

async function createNodeRecursive(
  def: DesignNode,
  parent: BaseNode & ChildrenMixin,
  idMapping: Record<string, string>,
  warnings: string[],
  loadedFonts: Set<string>,
): Promise<SceneNode> {
  let node: SceneNode;

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
          node = (comp as ComponentNode).createInstance();
        } else {
          warnings.push(`Component ${def.componentId} not found, creating frame instead`);
          node = figma.createFrame();
        }
      } else {
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
        await createNodeRecursive(childDef, node as BaseNode & ChildrenMixin, idMapping, warnings, loadedFonts);
      } catch (err: any) {
        warnings.push(`Failed to create child ${childDef.tempId || childDef.name || childDef.type}: ${err.message}`);
      }
    }
  }

  return node;
}

function applyNodeProperties(node: SceneNode, def: DesignNode, warnings: string[], loadedFonts: Set<string>): void {
  if (def.name !== undefined) node.name = def.name;
  if (def.x !== undefined) node.x = def.x;
  if (def.y !== undefined) node.y = def.y;

  if ('resize' in node) {
    if (def.width !== undefined && def.height !== undefined) {
      node.resize(def.width, def.height);
    } else if (def.width !== undefined) {
      node.resize(def.width, node.height);
    } else if (def.height !== undefined) {
      node.resize(node.width, def.height);
    }
  }

  if (def.rotation !== undefined && 'rotation' in node) (node as FrameNode).rotation = def.rotation;
  if (def.opacity !== undefined && 'opacity' in node) (node as FrameNode).opacity = def.opacity;
  if (def.visible !== undefined) node.visible = def.visible;
  if (def.locked !== undefined) node.locked = def.locked;

  if (def.fills !== undefined && 'fills' in node) {
    (node as GeometryMixin).fills = buildPaints(def.fills);
  }
  if (def.strokes !== undefined && 'strokes' in node) {
    (node as GeometryMixin).strokes = buildPaints(def.strokes);
  }
  if (def.strokeWeight !== undefined && 'strokeWeight' in node) {
    (node as GeometryMixin).strokeWeight = def.strokeWeight;
  }
  if (def.strokeAlign !== undefined && 'strokeAlign' in node) {
    (node as any).strokeAlign = def.strokeAlign;
  }
  if (def.effects !== undefined && 'effects' in node) {
    (node as BlendMixin).effects = buildEffects(def.effects);
  }

  if ('cornerRadius' in node) {
    const rect = node as RectangleNode;
    if (def.cornerRadius !== undefined) rect.cornerRadius = def.cornerRadius;
    if (def.topLeftRadius !== undefined) rect.topLeftRadius = def.topLeftRadius;
    if (def.topRightRadius !== undefined) rect.topRightRadius = def.topRightRadius;
    if (def.bottomLeftRadius !== undefined) rect.bottomLeftRadius = def.bottomLeftRadius;
    if (def.bottomRightRadius !== undefined) rect.bottomRightRadius = def.bottomRightRadius;
  }

  if (def.clipsContent !== undefined && 'clipsContent' in node) {
    (node as FrameNode).clipsContent = def.clipsContent;
  }

  if ('layoutMode' in node) {
    const frame = node as FrameNode;
    if (def.layoutMode !== undefined) frame.layoutMode = def.layoutMode;
    if (def.primaryAxisAlignItems !== undefined) frame.primaryAxisAlignItems = def.primaryAxisAlignItems;
    if (def.counterAxisAlignItems !== undefined) frame.counterAxisAlignItems = def.counterAxisAlignItems;
    if (def.paddingTop !== undefined) frame.paddingTop = def.paddingTop;
    if (def.paddingRight !== undefined) frame.paddingRight = def.paddingRight;
    if (def.paddingBottom !== undefined) frame.paddingBottom = def.paddingBottom;
    if (def.paddingLeft !== undefined) frame.paddingLeft = def.paddingLeft;
    if (def.itemSpacing !== undefined) frame.itemSpacing = def.itemSpacing;
    if (def.primaryAxisSizingMode !== undefined) frame.primaryAxisSizingMode = def.primaryAxisSizingMode;
    if (def.counterAxisSizingMode !== undefined) frame.counterAxisSizingMode = def.counterAxisSizingMode;
  }

  if (def.layoutGrow !== undefined && 'layoutGrow' in node) {
    (node as any).layoutGrow = def.layoutGrow;
  }
  if (def.layoutAlign !== undefined && 'layoutAlign' in node) {
    (node as any).layoutAlign = def.layoutAlign;
  }

  if (def.constraints !== undefined && 'constraints' in node) {
    (node as ConstraintMixin).constraints = {
      horizontal: def.constraints.horizontal as ConstraintType,
      vertical: def.constraints.vertical as ConstraintType,
    };
  }

  if (node.type === 'TEXT') {
    applyTextProperties(node as TextNode, def, warnings, loadedFonts);
  }
}

function applyTextProperties(textNode: TextNode, def: DesignNode, warnings: string[], loadedFonts: Set<string>): void {
  const fontFamily = def.fontFamily || FALLBACK_FONT.family;
  const fontStyle = def.fontStyle || FALLBACK_FONT.style;
  const fontKey = `${fontFamily}|${fontStyle}`;

  if (loadedFonts.has(fontKey)) {
    textNode.fontName = { family: fontFamily, style: fontStyle };
  } else {
    textNode.fontName = FALLBACK_FONT as FontName;
    if (def.fontFamily) {
      warnings.push(`Using Inter Regular instead of ${fontFamily} ${fontStyle}`);
    }
  }

  if (def.characters !== undefined) textNode.characters = def.characters;
  if (def.fontSize !== undefined) textNode.fontSize = def.fontSize;
  if (def.textAlignHorizontal !== undefined) textNode.textAlignHorizontal = def.textAlignHorizontal;
  if (def.textAlignVertical !== undefined) textNode.textAlignVertical = def.textAlignVertical;
  if (def.letterSpacing !== undefined) textNode.letterSpacing = { value: def.letterSpacing, unit: 'PIXELS' };
  if (def.textDecoration !== undefined) textNode.textDecoration = def.textDecoration;
  if (def.textCase !== undefined) textNode.textCase = def.textCase;

  if (def.lineHeight !== undefined) {
    if (typeof def.lineHeight === 'number') {
      textNode.lineHeight = { value: def.lineHeight, unit: 'PIXELS' };
    } else if (def.lineHeight.unit === 'AUTO') {
      textNode.lineHeight = { unit: 'AUTO' };
    } else {
      textNode.lineHeight = { value: def.lineHeight.value, unit: def.lineHeight.unit };
    }
  }
}

function buildPaints(defs: PaintDef[]): Paint[] {
  return defs.map(d => {
    if (d.type === 'SOLID') {
      return {
        type: 'SOLID' as const,
        color: d.color || { r: 0, g: 0, b: 0 },
        opacity: d.opacity ?? 1,
        visible: d.visible ?? true,
      };
    }
    if (d.type === 'IMAGE' && d.imageRef) {
      return {
        type: 'IMAGE' as const,
        scaleMode: 'FILL' as const,
        imageHash: d.imageRef,
        visible: d.visible ?? true,
      } as ImagePaint;
    }
    if (d.type === 'GRADIENT_LINEAR' && d.gradientStops) {
      return {
        type: 'GRADIENT_LINEAR' as const,
        gradientStops: d.gradientStops.map(s => ({
          position: s.position,
          color: { r: s.color.r, g: s.color.g, b: s.color.b, a: s.color.a },
        })),
        gradientTransform: (d.gradientTransform || [[1, 0, 0], [0, 1, 0]]) as Transform,
        visible: d.visible ?? true,
      } as GradientPaint;
    }
    // Fallback: transparent solid
    return {
      type: 'SOLID' as const,
      color: { r: 0, g: 0, b: 0 },
      opacity: 0,
      visible: d.visible ?? true,
    };
  });
}

function buildEffects(defs: EffectDef[]): Effect[] {
  return defs.map((d): Effect => {
    const visible = d.visible ?? true;

    if (d.type === 'DROP_SHADOW' || d.type === 'INNER_SHADOW') {
      return {
        type: d.type,
        visible,
        radius: d.radius,
        color: d.color || { r: 0, g: 0, b: 0, a: 0.25 },
        offset: d.offset || { x: 0, y: 4 },
        spread: d.spread ?? 0,
        blendMode: 'NORMAL',
      };
    }

    const blurType = d.type === 'BACKGROUND_BLUR' ? 'BACKGROUND_BLUR' : 'LAYER_BLUR';
    return { type: blurType, visible, radius: d.radius, blurType: 'NORMAL' } as Effect;
  });
}

async function handleUpdateNodes(payload: { updates: Array<{ nodeId: string; properties: DesignNode }> }): Promise<unknown> {
  const results: Array<{ nodeId: string; success: boolean; error?: string }> = [];
  const warnings: string[] = [];

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
      applyNodeProperties(node as SceneNode, upd.properties, warnings, loadedFonts);
      results.push({ nodeId: upd.nodeId, success: true });
    } catch (err: any) {
      results.push({ nodeId: upd.nodeId, success: false, error: err.message });
    }
  }

  return { results, warnings: warnings.length > 0 ? warnings : undefined };
}

function handleDeleteNodes(payload: { nodeIds: string[] }): unknown {
  const results: Array<{ nodeId: string; success: boolean; error?: string }> = [];
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
      (node as SceneNode).remove();
      results.push({ nodeId, success: true });
    } catch (err: any) {
      results.push({ nodeId, success: false, error: err.message });
    }
  }
  return { results };
}

function isMixed(value: unknown): boolean {
  return typeof value === 'symbol';
}

function safeValue(value: unknown, mixedLabel = 'MIXED'): unknown {
  return isMixed(value) ? mixedLabel : value;
}

function collectNodeInfo(node: BaseNode): Record<string, unknown> {
  const info: Record<string, unknown> = {
    id: node.id,
    type: node.type,
    name: node.name,
  };

  if ('x' in node) info.x = (node as SceneNode).x;
  if ('y' in node) info.y = (node as SceneNode).y;
  if ('width' in node) info.width = (node as SceneNode).width;
  if ('height' in node) info.height = (node as SceneNode).height;
  if ('rotation' in node) info.rotation = (node as FrameNode).rotation;
  if ('opacity' in node) info.opacity = (node as FrameNode).opacity;
  if ('visible' in node) info.visible = (node as SceneNode).visible;
  if ('fills' in node) info.fills = safeValue((node as GeometryMixin).fills);
  if ('strokes' in node) info.strokes = safeValue((node as GeometryMixin).strokes);
  if ('strokeWeight' in node) info.strokeWeight = safeValue((node as GeometryMixin).strokeWeight);
  if ('effects' in node) info.effects = safeValue((node as BlendMixin).effects);
  if ('cornerRadius' in node) info.cornerRadius = safeValue((node as RectangleNode).cornerRadius);
  if ('layoutMode' in node) info.layoutMode = (node as FrameNode).layoutMode;
  if ('children' in node) {
    info.children = ((node as any).children as SceneNode[]).map((c: SceneNode) => ({
      id: c.id,
      type: c.type,
      name: c.name,
    }));
  }
  if (node.type === 'TEXT') {
    const t = node as TextNode;
    info.characters = t.characters;
    info.fontSize = safeValue(t.fontSize);
    info.fontName = safeValue(t.fontName);
    if (isMixed(t.fontSize) || isMixed(t.fontName) || isMixed(t.fills)) {
      info.segments = extractTextSegments(t);
    }
  }

  return info;
}

function extractTextSegments(textNode: TextNode): unknown[] {
  const fields: Array<'fontName' | 'fontSize' | 'fills' | 'textDecoration' | 'textCase' | 'lineHeight' | 'letterSpacing'> =
    ['fontName', 'fontSize', 'fills', 'textDecoration', 'textCase', 'lineHeight', 'letterSpacing'];
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

function handleGetNodeInfo(payload: { nodeId: string }): unknown {
  const node = requireNode(payload.nodeId);
  return collectNodeInfo(node);
}

function handleGetNodesInfo(payload: { nodeIds: string[] }): unknown {
  const results: Array<{ nodeId: string; success: boolean; data?: Record<string, unknown>; error?: string }> = [];
  for (const nodeId of payload.nodeIds) {
    try {
      const node = figma.getNodeById(nodeId);
      if (!node) {
        results.push({ nodeId, success: false, error: 'Node not found' });
        continue;
      }
      results.push({ nodeId, success: true, data: collectNodeInfo(node) });
    } catch (err: any) {
      results.push({ nodeId, success: false, error: err.message });
    }
  }
  return { results };
}

function handleListPages(): unknown {
  return {
    pages: figma.root.children.map(page => ({
      id: page.id,
      name: page.name,
      isCurrent: page === figma.currentPage,
    })),
  };
}

function handleSetCurrentPage(payload: { pageId: string }): unknown {
  const page = figma.root.children.find(p => p.id === payload.pageId);
  if (!page) throw new Error(`Page ${payload.pageId} not found`);
  figma.currentPage = page;
  return { success: true, pageName: page.name };
}

function extractNodeArray(node: BaseNode, property: string): unknown[] {
  if (property in node) {
    const value = (node as any)[property];
    if (Array.isArray(value)) return value;
  }
  return [];
}

function requireNode(nodeId: string): BaseNode {
  const node = figma.getNodeById(nodeId);
  if (!node) throw new Error(`Node ${nodeId} not found`);
  return node;
}

function handleGetAnnotations(payload: { nodeId: string }): unknown {
  const node = requireNode(payload.nodeId);
  return {
    id: node.id,
    name: node.name,
    type: node.type,
    annotations: extractNodeArray(node, 'annotations'),
  };
}

function handleGetReactions(payload: { nodeId: string }): unknown {
  const node = requireNode(payload.nodeId);
  return {
    id: node.id,
    name: node.name,
    type: node.type,
    reactions: extractNodeArray(node, 'reactions'),
  };
}

function handleGetSelection(): unknown {
  const selection = figma.currentPage.selection;
  if (selection.length === 0) {
    return { nodes: [], message: 'Nothing selected' };
  }

  return {
    nodes: selection.map(node => ({
      ...collectNodeInfo(node),
      annotations: extractNodeArray(node, 'annotations'),
      reactions: extractNodeArray(node, 'reactions'),
    })),
  };
}

function handleScanAnnotations(payload: { nodeId?: string }): unknown {
  const root = payload.nodeId ? requireNode(payload.nodeId) : figma.currentPage;

  const results: Array<ReturnType<typeof nodeAnnotationSummary>> = [];

  function walk(node: BaseNode): void {
    const summary = nodeAnnotationSummary(node);
    if (summary.annotations.length > 0 || summary.reactions.length > 0) {
      results.push(summary);
    }
    if ('children' in node) {
      for (const child of (node as any).children) {
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

function nodeAnnotationSummary(node: BaseNode): {
  id: string;
  name: string;
  type: string;
  annotations: unknown[];
  reactions: unknown[];
} {
  return {
    id: node.id,
    name: node.name,
    type: node.type,
    annotations: extractNodeArray(node, 'annotations'),
    reactions: extractNodeArray(node, 'reactions'),
  };
}

async function handleExportNode(payload: { nodeId: string; format?: string; scale?: number }): Promise<unknown> {
  const node = requireNode(payload.nodeId);
  if (!('exportAsync' in node)) throw new Error(`Node ${payload.nodeId} does not support export`);

  const format = (payload.format || 'PNG').toUpperCase() as 'PNG' | 'SVG' | 'PDF' | 'JPG';
  const scale = payload.scale || 1;

  const settings: ExportSettings = format === 'SVG'
    ? { format: 'SVG' }
    : format === 'PDF'
      ? { format: 'PDF' }
      : { format: format === 'JPG' ? 'JPG' : 'PNG', constraint: { type: 'SCALE', value: scale } };

  const bytes = await (node as SceneNode).exportAsync(settings);
  const base64 = figma.base64Encode(bytes);

  return {
    nodeId: node.id,
    name: node.name,
    format,
    size: bytes.length,
    data: base64,
  };
}

function handleGetStyles(payload: { type?: string }): unknown {
  const filter = payload.type?.toUpperCase();
  const results: Record<string, unknown[]> = {};

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

function handleGetVariables(): unknown {
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

async function handleImportComponent(payload: { key: string }): Promise<unknown> {
  const component = await figma.importComponentByKeyAsync(payload.key);
  return {
    id: component.id,
    name: component.name,
    type: component.type,
    width: component.width,
    height: component.height,
  };
}

function handleCreateFromSvg(payload: { svg: string; x?: number; y?: number }): unknown {
  const node = figma.createNodeFromSvg(payload.svg);
  if (payload.x !== undefined) node.x = payload.x;
  if (payload.y !== undefined) node.y = payload.y;
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

function handleFindNodes(payload: { query?: string; type?: string; parentNodeId?: string; maxResults?: number; offset?: number }): unknown {
  const maxResults = payload.maxResults || 100;
  const offset = payload.offset || 0;
  const limit = offset + maxResults;
  const root = payload.parentNodeId
    ? requireNode(payload.parentNodeId)
    : figma.currentPage;

  if (!('findAll' in root)) throw new Error(`Node ${(root as BaseNode).id} does not support findAll`);

  const queryLower = payload.query?.toLowerCase();
  const typeFilter = payload.type?.toUpperCase();

  const allMatches: Array<{ id: string; name: string; type: string }> = [];
  let hasMore = false;

  (root as PageNode | FrameNode).findAll((node: SceneNode) => {
    if (allMatches.length > limit) {
      hasMore = true;
      return false;
    }
    if (typeFilter && node.type !== typeFilter) return false;
    if (queryLower && !node.name.toLowerCase().includes(queryLower)) return false;
    allMatches.push({ id: node.id, name: node.name, type: node.type });
    return false;
  });

  if (allMatches.length > limit) hasMore = true;
  const matches = allMatches.slice(offset, offset + maxResults);

  return { matches, totalFound: allMatches.length, offset, hasMore };
}

function handleGroupNodes(payload: { nodeIds: string[] }): unknown {
  if (!payload.nodeIds || payload.nodeIds.length < 1) {
    throw new Error('At least one node ID is required to group');
  }

  const nodes: SceneNode[] = [];
  for (const id of payload.nodeIds) {
    const node = figma.getNodeById(id);
    if (!node) throw new Error(`Node ${id} not found`);
    if (node.type === 'DOCUMENT' || node.type === 'PAGE') throw new Error(`Cannot group document/page nodes`);
    nodes.push(node as SceneNode);
  }

  const parent = nodes[0].parent;
  if (!parent || !('children' in parent)) throw new Error('Cannot determine parent for grouping');

  const group = figma.group(nodes, parent as BaseNode & ChildrenMixin);
  return {
    id: group.id,
    name: group.name,
    type: group.type,
    childCount: group.children.length,
  };
}

function handleUngroupNodes(payload: { nodeId: string }): unknown {
  const node = figma.getNodeById(payload.nodeId);
  if (!node) throw new Error(`Node ${payload.nodeId} not found`);
  if (node.type !== 'GROUP') throw new Error(`Node ${payload.nodeId} is not a group (type: ${node.type})`);

  const group = node as GroupNode;
  const childIds = group.children.map(c => ({ id: c.id, name: c.name, type: c.type }));
  figma.ungroup(group);

  return { ungrouped: true, children: childIds };
}

async function handleListFonts(): Promise<unknown> {
  const fonts = await figma.listAvailableFontsAsync();
  return {
    fonts: fonts.map(f => ({
      family: f.fontName.family,
      style: f.fontName.style,
    })),
    totalCount: fonts.length,
  };
}
