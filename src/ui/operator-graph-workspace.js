import { BUILTIN_OPERATOR_DEFINITIONS } from '../core/operator-graph.js';
import {
  OperatorGraphHistory,
  addOperatorNode,
  connectOperatorPorts,
  disconnectOperatorEdge,
  duplicateOperatorNode,
  removeOperatorNode,
  updateOperatorNodeParams
} from '../core/operator-graph-edit.js';
import {
  operatorCategoryLabel,
  operatorNodeLabel,
  operatorParamLabel,
  operatorParamOptions,
  operatorPortLabel,
  operatorPortTypeLabel
} from './operator-graph-localization.js';

const NODE_WIDTH = 196;
const NODE_HEADER_HEIGHT = 50;
const PORT_ROW_HEIGHT = 24;
const CANVAS_PADDING = 70;
const PROTECTED_NODE_IDS = ['viewport-output'];
const RUNTIME_REASON_LABELS = Object.freeze({
  bypass: '节点旁路',
  disabled: '节点已禁用',
  'bypassed-or-disabled': '景深旁路或未启用',
  'missing-perspective-depth': '缺少透视深度数据',
  created: '首次创建',
  'reset-version': '手动重置',
  'geometry-changed': '几何体已变化',
  'layout-changed': '粒子状态布局已变化',
  'timeline-seek': '时间轴跳转',
  running: '运行中',
  'missing-renderer-or-geometry': '缺少渲染器或几何体',
  'webgl2-vertex-textures-required': '需要 WebGL 2 顶点纹理支持',
  'float-feedback-unavailable': '显卡不支持浮点反馈'
});

function element(tagName, className, text) {
  const node = document.createElement(tagName);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function graphModeLabel(graph) {
  return graph.metadata?.mode === 'creator' ? '创作模式同步图' : '自定义节点图';
}

function nodeHeight(node) {
  const definition = BUILTIN_OPERATOR_DEFINITIONS[node.type];
  return NODE_HEADER_HEIGHT + Math.max(
    definition?.inputs?.length || 0,
    definition?.outputs?.length || 0,
    1
  ) * PORT_ROW_HEIGHT + 16;
}

function portAnchor(graph, endpoint, direction) {
  const node = graph.nodes.find((item) => item.id === endpoint.node);
  const definition = BUILTIN_OPERATOR_DEFINITIONS[node?.type];
  const ports = direction === 'output' ? definition?.outputs || [] : definition?.inputs || [];
  const index = Math.max(0, ports.findIndex((item) => item.id === endpoint.port));
  return {
    x: CANVAS_PADDING + Number(node?.position?.x || 0) + (direction === 'output' ? NODE_WIDTH : 0),
    y: CANVAS_PADDING + Number(node?.position?.y || 0) + NODE_HEADER_HEIGHT + index * PORT_ROW_HEIGHT + PORT_ROW_HEIGHT * 0.5
  };
}

function edgePath(from, to) {
  const distance = Math.max(48, Math.abs(to.x - from.x) * 0.46);
  return `M ${from.x} ${from.y} C ${from.x + distance} ${from.y}, ${to.x - distance} ${to.y}, ${to.x} ${to.y}`;
}

function formatParamValue(value) {
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : Number(value.toFixed(4)).toString();
  if (typeof value === 'boolean') return value ? '开启' : '关闭';
  if (value === undefined || value === null || value === '') return '—';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

function errorMessage(error) {
  return error?.message || String(error || '未知图谱错误');
}

function runtimeReasonLabel(reason, fallback = '未知原因') {
  return RUNTIME_REASON_LABELS[reason] || fallback;
}

function resourceFormatLabel(format) {
  return ({
    'points-f32': '32 位浮点粒子',
    rgba16f: '16 位浮点颜色',
    rgba32f: '32 位浮点颜色',
    depth24: '24 位深度',
    depth32f: '32 位浮点深度'
  })[format] || '图形资源';
}

function groupDefinitions() {
  const groups = new Map();
  Object.values(BUILTIN_OPERATOR_DEFINITIONS).forEach((definition) => {
    if (!groups.has(definition.category)) groups.set(definition.category, []);
    groups.get(definition.category).push(definition);
  });
  return groups;
}

export function createOperatorGraphWorkspace(actions) {
  const root = element('section', 'operator-graph-workspace');
  root.id = 'operatorGraphWorkspace';
  root.hidden = true;
  root.setAttribute('aria-label', '节点图工作区');

  const toolbar = element('header', 'operator-graph-toolbar');
  const titleBlock = element('div', 'operator-graph-title');
  titleBlock.append(
    element('strong', '', '实时节点图'),
    element('small', '', '中键拖动画布 · 左键拖动节点 · 端口拖线')
  );
  const status = element('div', 'operator-graph-status', '准备图谱…');
  status.id = 'operatorGraphStatus';

  const nodeTypeSelect = element('select', 'operator-graph-node-select');
  nodeTypeSelect.id = 'operatorGraphNodeType';
  nodeTypeSelect.setAttribute('aria-label', '节点类型');
  for (const [category, definitions] of groupDefinitions()) {
    const group = document.createElement('optgroup');
    group.label = operatorCategoryLabel(category);
    definitions.forEach((definition) => {
      const option = document.createElement('option');
      option.value = definition.type;
      option.textContent = operatorNodeLabel(definition.type, definition.label);
      group.append(option);
    });
    nodeTypeSelect.append(group);
  }
  nodeTypeSelect.value = 'post.glow';

  const addButton = element('button', 'operator-graph-button primary', '添加节点');
  addButton.type = 'button';
  addButton.id = 'operatorGraphAddNode';
  const undoButton = element('button', 'operator-graph-button compact', '撤销');
  undoButton.type = 'button';
  undoButton.id = 'operatorGraphUndo';
  const redoButton = element('button', 'operator-graph-button compact', '重做');
  redoButton.type = 'button';
  redoButton.id = 'operatorGraphRedo';
  const syncButton = element('button', 'operator-graph-button', '同步当前创作');
  syncButton.type = 'button';
  syncButton.id = 'operatorGraphSync';
  const validateButton = element('button', 'operator-graph-button', '验证图谱');
  validateButton.type = 'button';
  validateButton.id = 'operatorGraphValidate';
  toolbar.append(
    titleBlock,
    status,
    nodeTypeSelect,
    addButton,
    undoButton,
    redoButton,
    syncButton,
    validateButton
  );

  const viewport = element('div', 'operator-graph-viewport');
  const canvas = element('div', 'operator-graph-canvas');
  const edgeSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  edgeSvg.classList.add('operator-graph-edges');
  edgeSvg.setAttribute('aria-label', '节点连线');
  const nodeLayer = element('div', 'operator-graph-nodes');
  canvas.append(edgeSvg, nodeLayer);
  viewport.append(canvas);

  const inspector = element('aside', 'operator-graph-inspector');
  const inspectorEmpty = element('div', 'operator-graph-empty');
  inspectorEmpty.innerHTML = '<strong>选择一个节点或连线</strong><span>编辑参数、复制/删除节点，或双击连线断开。拖动输出端口到输入端口即可改线。</span>';
  const inspectorContent = element('div', 'operator-graph-inspector-content');
  inspectorContent.hidden = true;
  inspector.append(inspectorEmpty, inspectorContent);
  root.append(toolbar, viewport, inspector);

  let graph = null;
  let plan = null;
  let history = null;
  let selectedNodeId = '';
  let selectedEdgeId = '';
  let highlightedNodeIds = new Set();
  let dragState = null;
  let panState = null;
  let connectionState = null;
  let transientMessage = '';

  function canvasPoint(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function resizeCanvas() {
    if (!graph) return;
    const width = Math.max(
      1500,
      ...graph.nodes.map((node) => CANVAS_PADDING * 2 + Number(node.position.x) + NODE_WIDTH)
    );
    const height = Math.max(
      620,
      ...graph.nodes.map((node) => CANVAS_PADDING * 2 + Number(node.position.y) + nodeHeight(node))
    );
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    edgeSvg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  }

  function updateHistoryButtons() {
    undoButton.disabled = !history?.canUndo();
    redoButton.disabled = !history?.canRedo();
  }

  function renderStatus(validation = actions.validateGraph(graph), message = transientMessage) {
    const stageCount = plan?.stages?.length || 0;
    const runtimeStats = actions.getRuntimeStats?.();
    const runtimeLabel = runtimeStats?.frame
      ? ` · 运行 ${Number(runtimeStats.totalMs || 0).toFixed(2)} 毫秒`
      : '';
    const poolStats = runtimeStats?.resources?.pools?.[0];
    const poolLabel = poolStats
      ? ` · 资源池 ${poolStats.reuses} 次复用 / ${poolStats.allocations} 次新分配 / 峰值 ${poolStats.peakActiveLeases}`
      : '';
    const lifetimeStats = runtimeStats?.resources?.lifetime;
    const lifetimeLabel = lifetimeStats
      ? ` · 存活资源峰值 ${lifetimeStats.peakActiveResources} / 已释放 ${lifetimeStats.releases}`
      : '';
    const warningLabel = validation.warnings?.length ? ` · ${validation.warnings.length} 警告` : '';
    status.textContent = message || `${graphModeLabel(graph)} · ${graph.nodes.length} 节点 · ${graph.edges.length} 连线 · ${stageCount} 阶段 · ${validation.valid ? '有效' : `${validation.errors.length} 错误`}${warningLabel}${runtimeLabel}${poolLabel}${lifetimeLabel}`;
    status.title = status.textContent;
    status.classList.toggle('invalid', !validation.valid || Boolean(message?.startsWith('失败')));
    updateHistoryButtons();
  }

  function setTransientMessage(message, invalid = false) {
    transientMessage = message;
    renderStatus(actions.validateGraph(graph), message);
    status.classList.toggle('invalid', invalid);
  }

  function renderEdges() {
    edgeSvg.replaceChildren();
    if (!graph) return;
    for (const edge of graph.edges.filter((item) => item.enabled !== false)) {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', edgePath(portAnchor(graph, edge.from, 'output'), portAnchor(graph, edge.to, 'input')));
      path.classList.add('operator-graph-edge');
      path.dataset.edgeId = edge.id;
      if (edge.feedback) path.classList.add('feedback');
      if (edge.id === selectedEdgeId) path.classList.add('selected');
      if (highlightedNodeIds.has(edge.from.node) && highlightedNodeIds.has(edge.to.node)) path.classList.add('active');
      path.addEventListener('click', (event) => {
        event.stopPropagation();
        selectedEdgeId = edge.id;
        selectedNodeId = '';
        renderEdges();
        renderNodes();
        renderInspector();
      });
      path.addEventListener('dblclick', (event) => {
        event.stopPropagation();
        deleteSelection();
      });
      edgeSvg.append(path);
    }
    if (connectionState) {
      const preview = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      const from = portAnchor(graph, connectionState.from, 'output');
      preview.setAttribute('d', edgePath(from, connectionState.point || from));
      preview.classList.add('operator-graph-edge', 'connecting');
      edgeSvg.append(preview);
    }
  }

  function updateNodeSelectionClasses() {
    nodeLayer.querySelectorAll('.operator-node').forEach((card) => {
      card.classList.toggle('selected', card.dataset.nodeId === selectedNodeId);
    });
  }

  function selectNode(nodeId, options = {}) {
    selectedNodeId = nodeId;
    selectedEdgeId = '';
    if (options.preserveNodeElements) updateNodeSelectionClasses();
    else renderNodes();
    renderEdges();
    renderInspector();
  }

  function selectEdge(edgeId) {
    selectedEdgeId = edgeId;
    selectedNodeId = '';
    renderNodes();
    renderEdges();
    renderInspector();
  }

  function commitGraph(nextGraph, options = {}) {
    try {
      const customGraph = structuredClone(nextGraph);
      customGraph.metadata = { ...customGraph.metadata, mode: 'graph', synchronized: false };
      const result = actions.setGraph(customGraph, { dirtyNodeIds: options.dirtyNodeIds });
      graph = result.graph;
      plan = result.plan;
      if (options.history !== false) history?.commit(graph);
      if (options.selectNodeId !== undefined) selectedNodeId = options.selectNodeId;
      if (options.selectEdgeId !== undefined) selectedEdgeId = options.selectEdgeId;
      highlightedNodeIds = new Set(result.plan.executionNodeIds);
      transientMessage = options.message || '';
      resizeCanvas();
      renderNodes();
      renderEdges();
      renderInspector();
      renderStatus(result.validation, transientMessage);
      return true;
    } catch (error) {
      setTransientMessage(`失败：${errorMessage(error)}`, true);
      return false;
    }
  }

  function beginDrag(event, node) {
    if (event.button !== 0 || event.target.closest('.operator-port-dot')) return;
    const card = event.currentTarget.closest('.operator-node') || event.currentTarget;
    event.preventDefault();
    event.stopPropagation();
    dragState = {
      node,
      card,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: Number(node.position.x) || 0,
      originY: Number(node.position.y) || 0,
      moved: false
    };
    card.classList.add('dragging');
    selectNode(node.id, { preserveNodeElements: true });
    window.addEventListener('pointermove', moveDrag);
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
  }

  function moveDrag(event) {
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    const deltaX = event.clientX - dragState.startX;
    const deltaY = event.clientY - dragState.startY;
    dragState.moved ||= Math.hypot(deltaX, deltaY) > 2;
    if (!dragState.moved) return;
    dragState.node.position.x = Math.max(0, Math.round(dragState.originX + deltaX));
    dragState.node.position.y = Math.max(0, Math.round(dragState.originY + deltaY));
    dragState.card.style.left = `${CANVAS_PADDING + dragState.node.position.x}px`;
    dragState.card.style.top = `${CANVAS_PADDING + dragState.node.position.y}px`;
    resizeCanvas();
    renderEdges();
  }

  function endDrag(event) {
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    const moved = dragState.moved;
    dragState.card.classList.remove('dragging');
    dragState = null;
    window.removeEventListener('pointermove', moveDrag);
    window.removeEventListener('pointerup', endDrag);
    window.removeEventListener('pointercancel', endDrag);
    if (moved) commitGraph(graph, { message: '节点位置已更新' });
  }

  function beginPan(event) {
    if (event.button !== 1) return;
    event.preventDefault();
    event.stopPropagation();
    panState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      scrollLeft: viewport.scrollLeft,
      scrollTop: viewport.scrollTop
    };
    viewport.classList.add('panning');
    window.addEventListener('pointermove', movePan);
    window.addEventListener('pointerup', endPan);
    window.addEventListener('pointercancel', endPan);
  }

  function movePan(event) {
    if (!panState || event.pointerId !== panState.pointerId) return;
    event.preventDefault();
    viewport.scrollLeft = panState.scrollLeft - (event.clientX - panState.startX);
    viewport.scrollTop = panState.scrollTop - (event.clientY - panState.startY);
  }

  function endPan(event) {
    if (!panState || event.pointerId !== panState.pointerId) return;
    cancelPan();
  }

  function cancelPan() {
    panState = null;
    viewport.classList.remove('panning');
    window.removeEventListener('pointermove', movePan);
    window.removeEventListener('pointerup', endPan);
    window.removeEventListener('pointercancel', endPan);
  }

  function cancelConnection(message = '') {
    connectionState = null;
    window.removeEventListener('pointermove', moveConnection);
    window.removeEventListener('pointerup', finishConnection);
    renderEdges();
    if (message) setTransientMessage(message);
  }

  function beginConnection(event, node, operatorPort) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    selectNode(node.id);
    connectionState = {
      from: { node: node.id, port: operatorPort.id },
      point: canvasPoint(event),
      startX: event.clientX,
      startY: event.clientY,
      moved: false
    };
    window.addEventListener('pointermove', moveConnection);
    window.addEventListener('pointerup', finishConnection);
    setTransientMessage(
      `连接 ${operatorNodeLabel(node.type, node.label || node.id)}：${operatorPortLabel(operatorPort.id)} → 请选择输入端口`
    );
    renderEdges();
  }

  function moveConnection(event) {
    if (!connectionState) return;
    connectionState.point = canvasPoint(event);
    connectionState.moved ||= Math.hypot(
      event.clientX - connectionState.startX,
      event.clientY - connectionState.startY
    ) > 3;
    renderEdges();
  }

  function completeConnection(targetNodeId, targetPortId) {
    if (!connectionState) return;
    const from = { ...connectionState.from };
    cancelConnection();
    try {
      const result = connectOperatorPorts(graph, {
        from,
        to: { node: targetNodeId, port: targetPortId }
      });
      commitGraph(result.graph, {
        dirtyNodeIds: [targetNodeId],
        selectEdgeId: result.edgeId,
        selectNodeId: '',
        message: result.replacedEdgeIds.length
          ? `已改线，并替换 ${result.replacedEdgeIds.length} 条输入连接`
          : '连接已创建'
      });
    } catch (error) {
      setTransientMessage(`失败：${errorMessage(error)}`, true);
    }
  }

  function finishConnection(event) {
    if (!connectionState) return;
    window.removeEventListener('pointermove', moveConnection);
    window.removeEventListener('pointerup', finishConnection);
    const inputDot = document.elementFromPoint(event.clientX, event.clientY)?.closest?.('.operator-port-dot.input');
    if (inputDot) {
      completeConnection(inputDot.dataset.nodeId, inputDot.dataset.portId);
      return;
    }
    if (connectionState.moved) {
      cancelConnection('连接已取消');
      return;
    }
    connectionState.point = portAnchor(graph, connectionState.from, 'output');
    renderEdges();
  }

  function createPortRow(node, operatorPort, direction) {
    const row = element('div', `operator-port-row ${direction}`);
    const dot = element('button', `operator-port-dot ${direction} type-${operatorPort.type}`);
    dot.type = 'button';
    dot.dataset.nodeId = node.id;
    dot.dataset.portId = operatorPort.id;
    dot.dataset.portType = operatorPort.type;
    const portLabel = operatorPortLabel(operatorPort.id);
    const portTypeLabel = operatorPortTypeLabel(operatorPort.type);
    dot.setAttribute('aria-label', `${direction === 'output' ? '输出' : '输入'}：${portLabel}（${portTypeLabel}）`);
    const label = element('span', 'operator-port-label', portLabel);
    const type = element('span', 'operator-port-type', portTypeLabel);
    if (direction === 'input') {
      dot.addEventListener('pointerup', (event) => {
        if (!connectionState) return;
        event.preventDefault();
        event.stopPropagation();
        completeConnection(node.id, operatorPort.id);
      });
      dot.addEventListener('click', (event) => {
        if (!connectionState) return;
        event.preventDefault();
        event.stopPropagation();
        completeConnection(node.id, operatorPort.id);
      });
      row.append(dot, label, type);
    } else {
      dot.addEventListener('pointerdown', (event) => beginConnection(event, node, operatorPort));
      row.append(type, label, dot);
    }
    return row;
  }

  function renderNodes() {
    nodeLayer.replaceChildren();
    if (!graph) return;
    for (const node of graph.nodes) {
      const definition = BUILTIN_OPERATOR_DEFINITIONS[node.type];
      const card = element('article', 'operator-node');
      card.dataset.nodeId = node.id;
      card.dataset.nodeType = node.type;
      card.classList.toggle('selected', node.id === selectedNodeId);
      card.classList.toggle('executing', highlightedNodeIds.has(node.id));
      card.classList.toggle('disabled', node.enabled === false);
      card.classList.toggle('bypassed', node.bypass);
      card.style.left = `${CANVAS_PADDING + Number(node.position.x || 0)}px`;
      card.style.top = `${CANVAS_PADDING + Number(node.position.y || 0)}px`;
      card.style.height = `${nodeHeight(node)}px`;

      const header = element('header', 'operator-node-header');
      const category = element('span', 'operator-node-category', operatorCategoryLabel(definition?.category));
      const label = element('strong', '', operatorNodeLabel(node.type, node.label || definition?.label));
      header.append(category, label);

      const ports = element('div', 'operator-node-ports');
      const inputs = element('div', 'operator-node-inputs');
      const outputs = element('div', 'operator-node-outputs');
      (definition?.inputs || []).forEach((item) => inputs.append(createPortRow(node, item, 'input')));
      (definition?.outputs || []).forEach((item) => outputs.append(createPortRow(node, item, 'output')));
      ports.append(inputs, outputs);
      card.append(header, ports);
      card.addEventListener('pointerdown', (event) => beginDrag(event, node));
      card.addEventListener('click', (event) => {
        if (!event.target.closest('.operator-port-dot')) selectNode(node.id);
      });
      nodeLayer.append(card);
    }
  }

  function createParamEditor(node, key, value) {
    const row = element('label', 'operator-param-editor');
    const localizedLabel = operatorParamLabel(key);
    const label = element('span', '', localizedLabel);
    label.title = `内部参数：${key}`;
    row.append(label);
    let input;
    const choices = operatorParamOptions(node.type, key);
    if (choices) {
      input = document.createElement('select');
      const normalizedValue = String(value ?? '');
      if (!choices.some((choice) => choice.value === normalizedValue)) {
        const currentOption = document.createElement('option');
        currentOption.value = normalizedValue;
        currentOption.textContent = `当前值：${normalizedValue || '空'}`;
        input.append(currentOption);
      }
      choices.forEach((choice) => {
        const option = document.createElement('option');
        option.value = choice.value;
        option.textContent = choice.label;
        input.append(option);
      });
      input.value = normalizedValue;
    } else if (typeof value === 'boolean') {
      input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = value;
    } else if (typeof value === 'number') {
      input = document.createElement('input');
      input.type = 'number';
      input.step = 'any';
      input.value = String(value);
    } else if (value && typeof value === 'object') {
      input = document.createElement('textarea');
      input.rows = 2;
      input.value = JSON.stringify(value);
    } else {
      input = document.createElement('input');
      input.type = 'text';
      input.value = value ?? '';
    }
    input.dataset.paramKey = key;
    input.addEventListener('change', () => {
      let nextValue;
      try {
        if (choices) nextValue = input.value;
        else if (typeof value === 'boolean') nextValue = input.checked;
        else if (typeof value === 'number') {
          nextValue = Number(input.value);
          if (!Number.isFinite(nextValue)) throw new Error('请输入有效数字');
        } else if (value && typeof value === 'object') nextValue = JSON.parse(input.value);
        else nextValue = input.value;
      } catch (error) {
        setTransientMessage(`失败：参数“${localizedLabel}”${errorMessage(error)}`, true);
        return;
      }
      commitGraph(updateOperatorNodeParams(graph, node.id, { [key]: nextValue }), {
        dirtyNodeIds: [node.id],
        selectNodeId: node.id,
        message: `“${localizedLabel}”已更新`
      });
    });
    row.append(input);
    return row;
  }

  function renderInspector() {
    const node = graph?.nodes.find((item) => item.id === selectedNodeId);
    const edge = graph?.edges.find((item) => item.id === selectedEdgeId);
    inspectorEmpty.hidden = Boolean(node || edge);
    inspectorContent.hidden = !(node || edge);
    if (!node && !edge) {
      inspectorContent.replaceChildren();
      return;
    }
    if (edge) {
      const fromNode = graph.nodes.find((item) => item.id === edge.from.node);
      const toNode = graph.nodes.find((item) => item.id === edge.to.node);
      const fromLabel = operatorNodeLabel(fromNode?.type, fromNode?.label || '起点节点');
      const toLabel = operatorNodeLabel(toNode?.type, toNode?.label || '终点节点');
      const head = element('div', 'operator-inspector-head');
      head.append(
        element('small', '', edge.feedback ? '反馈连线' : '普通连线'),
        element('strong', '', `${fromLabel} → ${toLabel}`),
        element('code', '', `${operatorPortLabel(edge.from.port)} → ${operatorPortLabel(edge.to.port)}`)
      );
      const deleteButton = element('button', 'operator-graph-button danger', '断开连线');
      deleteButton.type = 'button';
      deleteButton.id = 'operatorGraphDisconnectEdge';
      deleteButton.addEventListener('click', deleteSelection);
      inspectorContent.replaceChildren(head, deleteButton);
      return;
    }

    const definition = BUILTIN_OPERATOR_DEFINITIONS[node.type];
    const runtimeStats = actions.getRuntimeStats?.();
    const nodeTiming = runtimeStats?.timings?.find((item) => item.nodeId === node.id);
    const gpuPass = runtimeStats?.resources?.passes?.find((item) => item.nodeId === node.id);
    const gpuResources = (runtimeStats?.resources?.resources || []).filter((item) => item.producerNodeId === node.id);
    const formatResource = (item) => item.kind === 'points' || item.kind === 'geometry'
      ? `${Number(item.count || 0).toLocaleString()} 个点 · ${(Number(item.byteLength || 0) / 1048576).toFixed(2)} MB · ${resourceFormatLabel(item.format)}`
      : `${item.width}×${item.height} · ${resourceFormatLabel(item.format)}`;
    const runtimeScopeLabel = runtimeStats?.scope === 'viewport' ? '视口' : runtimeStats?.scope || '当前视图';
    const head = element('div', 'operator-inspector-head');
    head.append(
      element('small', '', operatorCategoryLabel(definition?.category)),
      element('strong', '', operatorNodeLabel(node.type, node.label || definition?.label)),
      element(
        'span',
        'operator-node-runtime',
        nodeTiming
          ? `最近执行 ${nodeTiming.durationMs.toFixed(3)} 毫秒 · ${runtimeScopeLabel}`
          : runtimeStats?.cacheHitNodeIds?.includes(node.id)
            ? '最近一帧命中缓存'
            : '等待运行时采样'
      ),
      element(
        'span',
        'operator-node-runtime operator-node-resource',
        gpuPass
          ? gpuPass.skipped
            ? `GPU 处理已跳过 · ${runtimeReasonLabel(gpuPass.reason, '节点旁路')}`
            : gpuResources.length
              ? `资源：${gpuResources.map(formatResource).join(' + ')}`
              : '资源输出处理'
          : '尚未采样资源处理'
      )
    );

    const runButton = element('button', 'operator-graph-button primary', '预演下游执行');
    if (node.type === 'simulation.feedback-particles') {
      const feedbackResource = gpuResources.find((item) => item.metadata?.stage === 'particle-feedback');
      head.append(element(
        'span',
        'operator-node-runtime operator-node-resource',
        feedbackResource
          ? `状态 ${feedbackResource.metadata.stateTextureWidth}×${feedbackResource.metadata.stateTextureHeight} · ` +
            `累计 ${feedbackResource.metadata.computeSteps || 0} 个计算步 · ` +
            `${feedbackResource.metadata.reset ? `已重置：${runtimeReasonLabel(feedbackResource.metadata.resetReason)}` : '运行中'}`
          : gpuPass?.skipped
            ? `状态未推进 · ${runtimeReasonLabel(gpuPass.reason, '节点旁路')}`
            : '等待 GPU 粒子反馈状态'
      ));
    }
    runButton.type = 'button';
    runButton.id = 'operatorGraphPreviewExecution';
    runButton.addEventListener('click', () => {
      const dirtyPlan = actions.getPlan({ dirtyNodeIds: [node.id] });
      highlightedNodeIds = new Set(dirtyPlan.executionNodeIds);
      renderNodes();
      renderEdges();
      setTransientMessage(`从“${operatorNodeLabel(node.type, node.label || node.id)}”开始：本帧执行 ${dirtyPlan.executionNodeIds.length} 个节点 / ${dirtyPlan.executionStages.length} 个阶段`);
    });

    const bypassable = node.type === 'simulation.force-field' ||
      node.type === 'simulation.return-force' ||
      node.type === 'simulation.emitter' ||
      node.type === 'simulation.birth-life' ||
      node.type === 'simulation.attractor' ||
      node.type === 'simulation.collision-plane' ||
      node.type === 'simulation.trail' ||
      node.type === 'simulation.feedback-particles' ||
      node.type === 'post.glow' ||
      node.type === 'post.depth-of-field';
    const bypassButton = element(
      'button',
      `operator-graph-button operator-bypass-button${node.bypass ? ' active' : ''}`,
      node.bypass ? '取消旁路' : '旁路节点'
    );
    bypassButton.type = 'button';
    bypassButton.id = 'operatorGraphToggleBypass';
    bypassButton.hidden = !bypassable;
    bypassButton.addEventListener('click', () => {
      const next = structuredClone(graph);
      next.nodes.find((item) => item.id === node.id).bypass = !node.bypass;
      commitGraph(next, {
        dirtyNodeIds: [node.id],
        selectNodeId: node.id,
        message: node.bypass ? '已取消旁路' : '节点已旁路'
      });
    });

    const resetFeedbackButton = element('button', 'operator-graph-button', '重置状态');
    resetFeedbackButton.type = 'button';
    resetFeedbackButton.id = 'operatorGraphResetFeedback';
    resetFeedbackButton.hidden = node.type !== 'simulation.feedback-particles';
    resetFeedbackButton.addEventListener('click', () => {
      const resetVersion = Math.max(0, Math.floor(Number(node.params?.resetVersion) || 0)) + 1;
      commitGraph(updateOperatorNodeParams(graph, node.id, { resetVersion }), {
        dirtyNodeIds: [node.id],
        selectNodeId: node.id,
        message: `粒子反馈已重置 · 第 ${resetVersion} 次`
      });
    });

    const duplicateButton = element('button', 'operator-graph-button', '复制');
    duplicateButton.type = 'button';
    duplicateButton.id = 'operatorGraphDuplicateNode';
    duplicateButton.addEventListener('click', () => {
      try {
        const result = duplicateOperatorNode(graph, node.id);
        commitGraph(result.graph, { selectNodeId: result.nodeId, message: '节点已复制' });
      } catch (error) {
        setTransientMessage(`失败：${errorMessage(error)}`, true);
      }
    });
    const deleteButton = element('button', 'operator-graph-button danger', '删除');
    deleteButton.type = 'button';
    deleteButton.id = 'operatorGraphDeleteNode';
    deleteButton.disabled = PROTECTED_NODE_IDS.includes(node.id);
    deleteButton.title = deleteButton.disabled ? '视口输出是当前工作区的受保护输出节点' : '删除节点及其连线';
    deleteButton.addEventListener('click', deleteSelection);
    const actionsRow = element('div', 'operator-inspector-actions expanded');
    actionsRow.append(runButton, bypassButton, resetFeedbackButton, duplicateButton, deleteButton);

    const paramsTitle = element('div', 'operator-inspector-section-title', '节点参数（独立于创作面板）');
    const params = element('div', 'operator-param-editors');
    const entries = Object.entries(node.params || {});
    if (!entries.length) params.append(element('div', 'operator-param-empty', '该节点没有公开参数'));
    else entries.forEach(([key, value]) => params.append(createParamEditor(node, key, value)));

    const portsTitle = element('div', 'operator-inspector-section-title', '端口');
    const portsSummary = element('p', 'operator-port-summary');
    portsSummary.textContent = `输入 ${definition?.inputs?.length || 0} · 输出 ${definition?.outputs?.length || 0} · ${node.enabled === false ? '已禁用' : node.bypass ? '旁路' : '启用'}`;
    inspectorContent.replaceChildren(head, actionsRow, paramsTitle, params, portsTitle, portsSummary);
  }

  function addSelectedNode() {
    try {
      const type = nodeTypeSelect.value;
      const existing = graph.nodes.find((node) => node.type === type);
      const position = {
        x: Math.max(0, Math.round(viewport.scrollLeft + viewport.clientWidth * 0.5 - CANVAS_PADDING - NODE_WIDTH * 0.5)),
        y: Math.max(0, Math.round(viewport.scrollTop + viewport.clientHeight * 0.5 - CANVAS_PADDING - 60))
      };
      const result = addOperatorNode(graph, type, {
        position,
        params: existing?.params
      });
      commitGraph(result.graph, {
        selectNodeId: result.nodeId,
        message: `“${operatorNodeLabel(type, BUILTIN_OPERATOR_DEFINITIONS[type].label)}”已添加`
      });
    } catch (error) {
      setTransientMessage(`失败：${errorMessage(error)}`, true);
    }
  }

  function deleteSelection() {
    try {
      if (selectedEdgeId) {
        const next = disconnectOperatorEdge(graph, selectedEdgeId);
        commitGraph(next, { selectEdgeId: '', message: '连线已断开' });
        return;
      }
      if (!selectedNodeId) return;
      const next = removeOperatorNode(graph, selectedNodeId, { protectedNodeIds: PROTECTED_NODE_IDS });
      commitGraph(next, { selectNodeId: '', message: '节点及关联连线已删除' });
    } catch (error) {
      setTransientMessage(`失败：${errorMessage(error)}`, true);
    }
  }

  function applyHistory(direction) {
    if (!history) return;
    const canMove = direction === 'undo' ? history.canUndo() : history.canRedo();
    if (!canMove) return;
    const next = direction === 'undo' ? history.undo() : history.redo();
    const result = actions.setGraph(next);
    graph = result.graph;
    plan = result.plan;
    selectedNodeId = graph.nodes.some((node) => node.id === selectedNodeId) ? selectedNodeId : '';
    selectedEdgeId = graph.edges.some((edge) => edge.id === selectedEdgeId) ? selectedEdgeId : '';
    highlightedNodeIds = new Set(result.plan.executionNodeIds);
    transientMessage = direction === 'undo' ? '图谱已撤销' : '图谱已重做';
    resizeCanvas();
    renderNodes();
    renderEdges();
    renderInspector();
    renderStatus(result.validation, transientMessage);
  }

  function refresh(options = {}) {
    graph = actions.getGraph();
    plan = actions.getPlan();
    highlightedNodeIds = new Set();
    selectedNodeId = graph.nodes.some((node) => node.id === selectedNodeId) ? selectedNodeId : '';
    selectedEdgeId = graph.edges.some((edge) => edge.id === selectedEdgeId) ? selectedEdgeId : '';
    if (!history || options.resetHistory !== false) history = new OperatorGraphHistory(graph);
    transientMessage = '';
    resizeCanvas();
    renderNodes();
    renderEdges();
    renderInspector();
    renderStatus();
    if (options.center !== false) viewport.scrollTo({ left: 0, top: 0, behavior: 'instant' });
  }

  addButton.addEventListener('click', addSelectedNode);
  undoButton.addEventListener('click', () => applyHistory('undo'));
  redoButton.addEventListener('click', () => applyHistory('redo'));
  syncButton.addEventListener('click', () => {
    const result = actions.resetGraph();
    graph = result.graph;
    plan = result.plan;
    history = new OperatorGraphHistory(graph);
    selectedNodeId = '';
    selectedEdgeId = '';
    refresh({ resetHistory: true });
    setTransientMessage('已从当前创作面板状态重建节点图');
  });
  validateButton.addEventListener('click', () => {
    const validation = actions.validateGraph(graph);
    if (validation.valid) {
      setTransientMessage(`验证通过 · ${validation.stats.nodes} 节点 · ${validation.stats.enabledEdges} 有效连线 · ${validation.warnings.length} 警告`);
    } else {
      setTransientMessage(`失败：${validation.errors[0]?.message || '图谱无效'}`, true);
    }
  });
  viewport.addEventListener('pointerdown', beginPan, true);
  viewport.addEventListener('auxclick', (event) => {
    if (event.button === 1) event.preventDefault();
  });
  canvas.addEventListener('click', (event) => {
    if (event.target === canvas || event.target === edgeSvg || event.target === nodeLayer) {
      selectedNodeId = '';
      selectedEdgeId = '';
      renderNodes();
      renderEdges();
      renderInspector();
    }
  });
  window.addEventListener('keydown', (event) => {
    if (root.hidden) return;
    const editing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement;
    if (event.key === 'Escape') {
      cancelConnection('连接已取消');
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      applyHistory(event.shiftKey ? 'redo' : 'undo');
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      applyHistory('redo');
      return;
    }
    if (!editing && (event.key === 'Delete' || event.key === 'Backspace')) {
      event.preventDefault();
      deleteSelection();
    }
  });

  return {
    root,
    activate() {
      root.hidden = false;
      document.body.classList.add('operator-graph-mode');
      refresh({ resetHistory: true });
    },
    deactivate() {
      cancelConnection();
      cancelPan();
      root.hidden = true;
      document.body.classList.remove('operator-graph-mode');
    },
    refresh
  };
}
