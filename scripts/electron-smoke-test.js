import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ffmpegPath from 'ffmpeg-static';
import { _electron as electron } from 'playwright';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packaged = process.argv.includes('--packaged');
const executablePath = packaged
  ? path.join(rootDir, 'release', 'win-unpacked', 'Particle Model Studio.exe')
  : path.join(rootDir, 'node_modules', 'electron', 'dist', 'electron.exe');
const expectedVersion = JSON.parse(await readFile(path.join(rootDir, 'package.json'), 'utf8')).version;
const errors = [];
const projectSmokePath = path.join(rootDir, 'verification', 'electron-project-smoke.pms');
const streamedProjectSmokePath = path.join(rootDir, 'verification', 'electron-streamed-project-smoke.pms');
const streamedAssetSmokePath = path.join(rootDir, 'verification', 'electron-streamed-asset-smoke.ply');
const videoProjectSmokePath = path.join(rootDir, 'verification', 'electron-video-project-smoke.pms');
const videoAssetSmokePath = path.join(rootDir, 'verification', 'electron-video-asset-smoke.mp4');
const movAssetSmokePath = path.join(rootDir, 'verification', 'electron-video-alpha-smoke.mov');
const missingProjectSmokePath = path.join(rootDir, 'verification', 'electron-missing-project-smoke.pms');
const automaticRecoveryFailurePath = path.join(rootDir, 'verification', 'missing-auto-save-dir', 'automatic-recovery-smoke.pms');
const pathReferenceProjectSmokePath = path.join(rootDir, 'verification', 'electron-path-reference-smoke.pms');
const uiScreenshotPath = path.join(rootDir, 'verification', packaged ? 'electron-ui-packaged.png' : 'electron-ui.png');
const uiCameraScreenshotPath = path.join(rootDir, 'verification', packaged ? 'electron-ui-camera-packaged.png' : 'electron-ui-camera.png');
const uiGraphScreenshotPath = path.join(rootDir, 'verification', packaged ? 'electron-ui-graph-packaged.png' : 'electron-ui-graph.png');
let electronApp;
let recoverySmokeOutputPath = '';
let automaticRecoveryOutputPath = '';
const launchEnv = { ...process.env };
delete launchEnv.ELECTRON_RUN_AS_NODE;

try {
  await mkdir(path.dirname(projectSmokePath), { recursive: true });
  await rm(projectSmokePath, { force: true });
  await rm(streamedProjectSmokePath, { force: true });
  await rm(streamedAssetSmokePath, { force: true });
  await rm(videoProjectSmokePath, { force: true });
  await rm(videoAssetSmokePath, { force: true });
  await rm(movAssetSmokePath, { force: true });
  await rm(missingProjectSmokePath, { force: true });
  await rm(pathReferenceProjectSmokePath, { force: true });
  await rm(path.dirname(automaticRecoveryFailurePath), { recursive: true, force: true });
  await writeFile(streamedAssetSmokePath, Buffer.alloc(8 * 1024 * 1024, 0x5a));
  await writeFile(videoAssetSmokePath, Buffer.from('00000018667479706d703432000000006d70343269736f6d', 'hex'));
  await createAlphaMovSmoke(movAssetSmokePath);
  electronApp = await electron.launch({
    executablePath,
    args: packaged ? [] : ['.'],
    cwd: rootDir,
    env: {
      ...launchEnv,
      ELECTRON_ENABLE_LOGGING: '1'
    },
    timeout: 60000
  });
  const appVersion = await electronApp.evaluate(({ app }) => app.getVersion());
  if (appVersion !== expectedVersion) {
    throw new Error(`Packaged app version mismatch: expected ${expectedVersion}, got ${appVersion}`);
  }

  await electronApp.evaluate(async ({ dialog }, paths) => {
    dialog.showSaveDialog = async (_owner, options = {}) => {
      const requestedName = String(options.defaultPath || '');
      const filePath = requestedName.includes('streamed-project')
        ? paths.streamed
        : requestedName.includes('video-project')
          ? paths.video
        : requestedName.includes('missing-project')
          ? paths.missing
          : paths.project;
      return { canceled: false, filePath };
    };
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [paths.project] });
  }, {
    project: projectSmokePath,
    streamed: streamedProjectSmokePath,
    video: videoProjectSmokePath,
    missing: missingProjectSmokePath
  });

  const page = await electronApp.firstWindow({ timeout: 60000 });
  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.push(`console: ${message.text()}`);
    }
  });
  page.on('pageerror', (error) => {
    errors.push(`pageerror: ${error.message}`);
  });

  await page.waitForFunction(() => window.particleStudio?.isReady(), null, { timeout: 90000 });
  await page.evaluate(() => window.particleStudio?.setCameraPreviewVisible?.(true));
  await page.waitForTimeout(60);
  const uiLayout = await page.evaluate(() => {
    const panel = document.querySelector('.panel');
    const canvas = document.querySelector('#scene');
    const topbar = document.querySelector('.workspace-topbar');
    const timeline = document.querySelector('.workspace-timeline-dock');
    const outliner = document.querySelector('.workspace-outliner-pane');
    const properties = document.querySelector('.workspace-properties-pane');
    const rightResizer = document.querySelector('.workspace-resizer-right');
    const timelineResizer = document.querySelector('.workspace-resizer-timeline');
    const sceneRows = document.querySelectorAll('.scene-model-row').length;
    const sceneCameraPanel = document.querySelector('#sceneCamerasPanel');
    const sceneCameraRows = document.querySelectorAll('.scene-camera-row').length;
    const sceneCameraEnabled = document.querySelectorAll('.scene-camera-row.enabled').length;
    const qualityMode = document.querySelector('#qualityMode');
    const qualityStatus = document.querySelector('#qualityStatus');
    const graphTab = document.querySelector('[data-workspace-mode="graph"]');
    const layoutTab = document.querySelector('[data-workspace-mode="layout"]');
    const feedbackCreatorInputs = {
      strength: document.querySelector('#feedbackStrength'),
      turbulence: document.querySelector('#feedbackTurbulence'),
      drag: document.querySelector('#feedbackDrag')
    };
    document.querySelector('[data-property-tab="dissolve"]')?.click();
    feedbackCreatorInputs.strength.value = '1.1';
    feedbackCreatorInputs.turbulence.value = '1.3';
    feedbackCreatorInputs.drag.value = '0.9';
    Object.values(feedbackCreatorInputs).forEach((control) => {
      control.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const creatorFeedbackGraph = window.particleStudio.getOperatorGraph();
    const creatorFeedbackParams = creatorFeedbackGraph.nodes
      .find((node) => node.type === 'simulation.feedback-particles')?.params || {};
    const creatorForceParams = creatorFeedbackGraph.nodes
      .find((node) => node.type === 'simulation.force-field')?.params || {};
    const feedbackCreatorControls = {
      visible: Object.values(feedbackCreatorInputs).every((control) => Boolean(control?.offsetParent)),
      enabled: creatorFeedbackParams.enabled !== false,
      strength: creatorFeedbackParams.strength,
      turbulence: creatorForceParams.turbulence,
      drag: creatorFeedbackParams.drag
    };
    const flowStyleCards = [...document.querySelectorAll('[data-flow-style]')].map((button) => ({
      style: button.dataset.flowStyle,
      active: button.classList.contains('is-active'),
      pressed: button.getAttribute('aria-pressed')
    }));
    const flowMotionStatus = document.querySelector('#flowMotionStatus')?.textContent || '';
    document.querySelector('[data-property-tab="emission"]')?.click();
    const emissionModeRouting = {
      effectMode: window.particleStudio.getOptions().effectMode,
      activePropertyTab: document.querySelector('.workspace-property-tab.active')?.dataset.propertyTab || '',
      visiblePropertyPage: document.querySelector('.workspace-property-page:not([hidden])')?.dataset.propertyPage || '',
      activeModeButton: document.querySelector('[data-effect-mode].active')?.dataset.effectMode || '',
      controlsVisible: Boolean(document.querySelector('#emissionPanel')?.offsetParent)
    };
    document.querySelector('[data-property-tab="dissolve"]')?.click();
    const dissolveModeRouting = {
      effectMode: window.particleStudio.getOptions().effectMode,
      activePropertyTab: document.querySelector('.workspace-property-tab.active')?.dataset.propertyTab || '',
      visiblePropertyPage: document.querySelector('.workspace-property-page:not([hidden])')?.dataset.propertyPage || ''
    };
    graphTab?.click();
    const graphWorkspace = document.querySelector('#operatorGraphWorkspace');
    const graphWorkspaceOpened = Boolean(graphWorkspace && !graphWorkspace.hidden);
    const graphNodeCount = graphWorkspace?.querySelectorAll('.operator-node').length || 0;
    const graphStatus = graphWorkspace?.querySelector('#operatorGraphStatus')?.textContent || '';
    const graphViewport = graphWorkspace?.querySelector('.operator-graph-viewport');
    const modelNodeBeforeDrag = window.particleStudio.getOperatorGraph().nodes.find((node) => node.id === 'model-input');
    const modelNodeCard = graphWorkspace?.querySelector('.operator-node[data-node-id="model-input"]');
    if (modelNodeCard) {
      const rect = modelNodeCard.getBoundingClientRect();
      modelNodeCard.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true,
        button: 0,
        buttons: 1,
        pointerId: 71,
        clientX: rect.left + rect.width * 0.5,
        clientY: rect.top + rect.height - 12
      }));
      window.dispatchEvent(new PointerEvent('pointermove', {
        bubbles: true,
        buttons: 1,
        pointerId: 71,
        clientX: rect.left + rect.width * 0.5 + 48,
        clientY: rect.top + rect.height + 20
      }));
      window.dispatchEvent(new PointerEvent('pointerup', {
        bubbles: true,
        button: 0,
        pointerId: 71,
        clientX: rect.left + rect.width * 0.5 + 48,
        clientY: rect.top + rect.height + 20
      }));
    }
    const modelNodeAfterDrag = window.particleStudio.getOperatorGraph().nodes.find((node) => node.id === 'model-input');
    if (graphViewport) graphViewport.scrollLeft = 360;
    const panNodeCard = graphWorkspace?.querySelector('.operator-node[data-node-id="particle-render"]');
    const panBefore = graphViewport?.scrollLeft || 0;
    if (panNodeCard) {
      const rect = panNodeCard.getBoundingClientRect();
      panNodeCard.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true,
        button: 1,
        buttons: 4,
        pointerId: 72,
        clientX: rect.left + rect.width * 0.5,
        clientY: rect.top + 18
      }));
      window.dispatchEvent(new PointerEvent('pointermove', {
        bubbles: true,
        buttons: 4,
        pointerId: 72,
        clientX: rect.left + rect.width * 0.5 - 64,
        clientY: rect.top + 18
      }));
      window.dispatchEvent(new PointerEvent('pointerup', {
        bubbles: true,
        button: 1,
        pointerId: 72,
        clientX: rect.left + rect.width * 0.5 - 64,
        clientY: rect.top + 18
      }));
    }
    const graphInteraction = {
      nodeDeltaX: Number(modelNodeAfterDrag?.position?.x || 0) - Number(modelNodeBeforeDrag?.position?.x || 0),
      nodeDeltaY: Number(modelNodeAfterDrag?.position?.y || 0) - Number(modelNodeBeforeDrag?.position?.y || 0),
      nodeSelected: graphWorkspace?.querySelector('.operator-node[data-node-id="model-input"]')?.classList.contains('selected'),
      panDeltaX: (graphViewport?.scrollLeft || 0) - panBefore,
      panningEnded: !graphViewport?.classList.contains('panning')
    };

    const nodeTypeSelect = graphWorkspace?.querySelector('#operatorGraphNodeType');
    const simulationNodeOptions = [...(nodeTypeSelect?.options || [])].map((option) => option.value);
    const localizedNodeOptions = [...(nodeTypeSelect?.options || [])].map((option) => option.textContent || '');
    const localizedNodeGroups = [...(nodeTypeSelect?.querySelectorAll('optgroup') || [])].map((group) => group.label || '');
    if (nodeTypeSelect) nodeTypeSelect.value = 'simulation.emitter';
    graphWorkspace?.querySelector('#operatorGraphAddNode')?.click();
    const addedEmitterNode = window.particleStudio.getOperatorGraph().nodes.at(-1);
    const emitterDefaults = structuredClone(addedEmitterNode?.params || {});
    const emitterParamKeys = [...(graphWorkspace?.querySelectorAll('[data-param-key]') || [])]
      .map((input) => input.dataset.paramKey);
    const emitterBypassVisible = !graphWorkspace?.querySelector('#operatorGraphToggleBypass')?.hidden;
    graphWorkspace?.querySelector('#operatorGraphDeleteNode')?.click();
    if (nodeTypeSelect) nodeTypeSelect.value = 'simulation.birth-life';
    graphWorkspace?.querySelector('#operatorGraphAddNode')?.click();
    const addedBirthLifeNode = window.particleStudio.getOperatorGraph().nodes.at(-1);
    const birthLifeDefaults = structuredClone(addedBirthLifeNode?.params || {});
    const birthLifeParamKeys = [...(graphWorkspace?.querySelectorAll('[data-param-key]') || [])]
      .map((input) => input.dataset.paramKey);
    const birthLifeBypassVisible = !graphWorkspace?.querySelector('#operatorGraphToggleBypass')?.hidden;
    graphWorkspace?.querySelector('#operatorGraphDeleteNode')?.click();
    if (nodeTypeSelect) nodeTypeSelect.value = 'simulation.attractor';
    graphWorkspace?.querySelector('#operatorGraphAddNode')?.click();
    const addedAttractorNode = window.particleStudio.getOperatorGraph().nodes.at(-1);
    const attractorDefaults = structuredClone(addedAttractorNode?.params || {});
    const attractorParamKeys = [...(graphWorkspace?.querySelectorAll('[data-param-key]') || [])]
      .map((input) => input.dataset.paramKey);
    const attractorBypassVisible = !graphWorkspace?.querySelector('#operatorGraphToggleBypass')?.hidden;
    graphWorkspace?.querySelector('#operatorGraphDeleteNode')?.click();
    if (nodeTypeSelect) nodeTypeSelect.value = 'simulation.collision-plane';
    graphWorkspace?.querySelector('#operatorGraphAddNode')?.click();
    const addedCollisionNode = window.particleStudio.getOperatorGraph().nodes.at(-1);
    const collisionDefaults = structuredClone(addedCollisionNode?.params || {});
    const collisionParamKeys = [...(graphWorkspace?.querySelectorAll('[data-param-key]') || [])]
      .map((input) => input.dataset.paramKey);
    const collisionBypassVisible = !graphWorkspace?.querySelector('#operatorGraphToggleBypass')?.hidden;
    graphWorkspace?.querySelector('#operatorGraphDeleteNode')?.click();
    if (nodeTypeSelect) nodeTypeSelect.value = 'simulation.trail';
    graphWorkspace?.querySelector('#operatorGraphAddNode')?.click();
    const addedTrailNode = window.particleStudio.getOperatorGraph().nodes.at(-1);
    const trailDefaults = structuredClone(addedTrailNode?.params || {});
    const trailParamKeys = [...(graphWorkspace?.querySelectorAll('[data-param-key]') || [])]
      .map((input) => input.dataset.paramKey);
    const trailBypassVisible = !graphWorkspace?.querySelector('#operatorGraphToggleBypass')?.hidden;
    graphWorkspace?.querySelector('#operatorGraphDeleteNode')?.click();
    if (nodeTypeSelect) nodeTypeSelect.value = 'post.glow';
    graphWorkspace?.querySelector('#operatorGraphAddNode')?.click();
    const addedNodeCount = graphWorkspace?.querySelectorAll('.operator-node').length || 0;
    const addedNodeId = window.particleStudio.getOperatorGraph().nodes.at(-1)?.id || '';
    const glowRadiusInput = graphWorkspace?.querySelector('[data-param-key="glowRadius"]');
    if (glowRadiusInput) {
      glowRadiusInput.value = '44';
      glowRadiusInput.dispatchEvent(new Event('change', { bubbles: true }));
    }
    const localizedGraphUi = {
      nodeOptions: localizedNodeOptions,
      nodeGroups: localizedNodeGroups,
      glowNodeLabel: graphWorkspace?.querySelector(`.operator-node[data-node-id="${addedNodeId}"] .operator-node-header strong`)?.textContent || '',
      glowRadiusLabel: graphWorkspace?.querySelector('[data-param-key="glowRadius"]')?.closest('.operator-param-editor')?.querySelector('span')?.textContent || '',
      portLabels: [...(graphWorkspace?.querySelectorAll('.operator-port-label') || [])].map((item) => item.textContent || ''),
      portTypes: [...(graphWorkspace?.querySelectorAll('.operator-port-type') || [])].map((item) => item.textContent || '')
    };
    const addedGlowRadius = window.particleStudio.getOperatorGraph().nodes
      .find((node) => node.id === addedNodeId)?.params?.glowRadius;
    graphWorkspace?.querySelector('#operatorGraphDuplicateNode')?.click();
    const duplicatedNodeCount = graphWorkspace?.querySelectorAll('.operator-node').length || 0;
    graphWorkspace?.querySelector('#operatorGraphUndo')?.click();
    const undoNodeCount = graphWorkspace?.querySelectorAll('.operator-node').length || 0;
    graphWorkspace?.querySelector('#operatorGraphRedo')?.click();
    const redoNodeCount = graphWorkspace?.querySelectorAll('.operator-node').length || 0;
    const redoNodeId = window.particleStudio.getOperatorGraph().nodes.at(-1)?.id;
    graphWorkspace?.querySelector(`.operator-node[data-node-id="${redoNodeId}"]`)?.click();
    graphWorkspace?.querySelector('#operatorGraphDeleteNode')?.click();
    const deletedNodeCount = graphWorkspace?.querySelectorAll('.operator-node').length || 0;

    const renderOutput = graphWorkspace?.querySelector(
      '.operator-node[data-node-id="particle-render"] .operator-port-dot.output[data-port-id="color"]'
    );
    if (renderOutput) {
      const rect = renderOutput.getBoundingClientRect();
      renderOutput.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true,
        button: 0,
        pointerId: 77,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2
      }));
      graphWorkspace?.querySelector(
        '.operator-node[data-node-id="viewport-output"] .operator-port-dot.input[data-port-id="color"]'
      )?.click();
    }
    const rewiredGraph = window.particleStudio.getOperatorGraph();
    const viewportInputEdge = rewiredGraph.edges.find((edge) => edge.to.node === 'viewport-output');
    const directViewportConnection = viewportInputEdge?.from?.node === 'particle-render';
    window.particleStudio.renderFrame(0, undefined, 0);
    const glowDemandSkipped = !window.particleStudio.getOperatorRuntimeStats().demandedNodeIds?.includes('multi-glow');
    graphWorkspace?.querySelector('#operatorGraphUndo')?.click();
    const undoRestoredDofConnection = window.particleStudio.getOperatorGraph().edges
      .some((edge) => edge.from.node === 'viewport-dof' && edge.to.node === 'viewport-output');

    const graphEditor = {
      simulationNodeOptions,
      emitterDefaults,
      emitterParamKeys,
      emitterBypassVisible,
      birthLifeDefaults,
      birthLifeParamKeys,
      birthLifeBypassVisible,
      attractorDefaults,
      attractorParamKeys,
      attractorBypassVisible,
      collisionDefaults,
      collisionParamKeys,
      collisionBypassVisible,
      trailDefaults,
      trailParamKeys,
      trailBypassVisible,
      addedNodeCount,
      addedNodeId,
      addedGlowRadius,
      duplicatedNodeCount,
      undoNodeCount,
      redoNodeCount,
      deletedNodeCount,
      directViewportConnection,
      glowDemandSkipped,
      undoRestoredDofConnection
    };
    graphWorkspace?.querySelector('#operatorGraphSync')?.click();
    const feedbackNode = graphWorkspace?.querySelector('[data-node-type="simulation.feedback-particles"]');
    feedbackNode?.click();
    const feedbackResetBefore = Number(window.particleStudio.getOperatorGraph().nodes
      .find((node) => node.type === 'simulation.feedback-particles')?.params?.resetVersion || 0);
    graphWorkspace?.querySelector('#operatorGraphResetFeedback')?.click();
    const feedbackResetAfter = Number(window.particleStudio.getOperatorGraph().nodes
      .find((node) => node.type === 'simulation.feedback-particles')?.params?.resetVersion || 0);
    const feedbackResetButtonVisible = !graphWorkspace?.querySelector('#operatorGraphResetFeedback')?.hidden;
    graphWorkspace?.querySelector('#operatorGraphSync')?.click();
    const deepGlowNode = graphWorkspace?.querySelector('[data-node-type="post.glow"]');
    deepGlowNode?.click();
    graphWorkspace?.querySelector('#operatorGraphPreviewExecution')?.click();
    const graphExecutionStatus = graphWorkspace?.querySelector('#operatorGraphStatus')?.textContent || '';
    const graphInspectorVisible = !graphWorkspace?.querySelector('.operator-graph-inspector-content')?.hidden;
    graphWorkspace?.querySelector('#operatorGraphToggleBypass')?.click();
    const graphBypassActive = graphWorkspace?.querySelector('#operatorGraphToggleBypass')?.textContent === '取消旁路';
    const graphBypassMode = window.particleStudio.getOperatorGraph().metadata.mode;
    graphWorkspace?.querySelector('#operatorGraphSync')?.click();
    layoutTab?.click();
    const graphWorkspaceClosed = Boolean(graphWorkspace?.hidden);
    const videoKeyButtons = document.querySelectorAll('.video-keyframe-dot, .video-transform-key').length;
    const frameTicks = [...document.querySelectorAll('.timeline-frame-tick')].map((item) => item.textContent.trim()).filter(Boolean);
    const timelineValue = document.querySelector('#timelineValue')?.textContent || '';
    const propertyTabs = [...document.querySelectorAll('.workspace-property-tab')].map((item) => item.dataset.propertyTab);
    const activePropertyTab = document.querySelector('.workspace-property-tab.active')?.dataset.propertyTab || '';
    const visiblePropertyPage = document.querySelector('.workspace-property-page:not([hidden])')?.dataset.propertyPage || '';
    const panelRect = panel.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    const topbarRect = topbar.getBoundingClientRect();
    const timelineRect = timeline.getBoundingClientRect();
    return {
      workspace: document.body.classList.contains('workspace-layout'),
      panelWidth: panel.clientWidth,
      panelLeft: Math.round(panelRect.left),
      panelRightGap: Math.round(window.innerWidth - panelRect.right),
      canvasLeft: Math.round(canvasRect.left),
      canvasTop: Math.round(canvasRect.top),
      canvasRightGap: Math.round(window.innerWidth - canvasRect.right),
      canvasBottomGap: Math.round(window.innerHeight - canvasRect.bottom),
      canvasWidth: Math.round(canvasRect.width),
      canvasHeight: Math.round(canvasRect.height),
      topbarHeight: Math.round(topbarRect.height),
      timelineHeight: Math.round(timelineRect.height),
      timelineTop: Math.round(timelineRect.top),
      outlinerHeight: Math.round(outliner.getBoundingClientRect().height),
      propertiesHeight: Math.round(properties.getBoundingClientRect().height),
      hasRightResizer: Boolean(rightResizer),
      hasTimelineResizer: Boolean(timelineResizer),
      frameTicks,
      timelineValue,
      propertyTabs,
      activePropertyTab,
      visiblePropertyPage,
      sceneRows,
      sceneCameraPanel: Boolean(sceneCameraPanel),
      sceneCameraRows,
      sceneCameraEnabled,
      qualityMode: qualityMode?.value || '',
      qualityOptions: qualityMode?.options?.length || 0,
      qualityStatus: qualityStatus?.textContent || '',
      graphWorkspaceOpened,
      graphWorkspaceClosed,
      graphNodeCount,
      graphStatus,
      graphInteraction,
      localizedGraphUi,
      graphEditor,
      graphExecutionStatus,
      graphInspectorVisible,
      graphBypassActive,
      graphBypassMode,
      feedbackResetBefore,
      feedbackResetAfter,
      feedbackResetButtonVisible,
      feedbackCreatorControls,
      flowStyleCards,
      flowMotionStatus,
      emissionModeRouting,
      dissolveModeRouting,
      videoKeyButtons
    };
  });
  if (
    !uiLayout.workspace ||
    uiLayout.panelWidth < 300 ||
    uiLayout.panelRightGap > 2 ||
    uiLayout.canvasLeft < 40 ||
    uiLayout.canvasTop < 30 ||
    uiLayout.canvasRightGap < uiLayout.panelWidth - 4 ||
    uiLayout.canvasBottomGap < uiLayout.timelineHeight - 4 ||
    uiLayout.canvasWidth < 480 ||
    uiLayout.canvasHeight < 280 ||
    uiLayout.timelineTop < uiLayout.canvasTop + uiLayout.canvasHeight - 2 ||
    uiLayout.outlinerHeight < 110 ||
    uiLayout.propertiesHeight < 160 ||
    !uiLayout.hasRightResizer ||
    !uiLayout.hasTimelineResizer ||
    uiLayout.frameTicks.length < 4 ||
    !uiLayout.frameTicks.includes('1') ||
    !/^.+F\d+/.test(uiLayout.timelineValue) ||
    uiLayout.propertyTabs.length < 8 ||
    !uiLayout.propertyTabs.includes('camera') ||
    uiLayout.activePropertyTab !== uiLayout.visiblePropertyPage ||
    uiLayout.sceneRows < 1 ||
    !uiLayout.sceneCameraPanel ||
    uiLayout.sceneCameraRows < 1 ||
    uiLayout.sceneCameraEnabled !== 1 ||
    uiLayout.qualityOptions !== 4 ||
    !uiLayout.qualityStatus.includes('Glow') ||
    !uiLayout.graphWorkspaceOpened ||
    !uiLayout.graphWorkspaceClosed ||
    uiLayout.graphNodeCount !== 13 ||
    !uiLayout.graphStatus.includes('有效') ||
    !uiLayout.graphStatus.includes('资源池') ||
    !uiLayout.graphStatus.includes('存活资源') ||
    !uiLayout.graphExecutionStatus.includes('执行 3 个节点') ||
    !uiLayout.graphInspectorVisible ||
    uiLayout.graphInteraction?.nodeDeltaX !== 48 ||
    uiLayout.graphInteraction?.nodeDeltaY !== 32 ||
    !uiLayout.graphInteraction?.nodeSelected ||
    uiLayout.graphInteraction?.panDeltaX < 50 ||
    !uiLayout.graphInteraction?.panningEnded ||
    !uiLayout.localizedGraphUi?.nodeOptions?.includes('多层深度辉光') ||
    !uiLayout.localizedGraphUi?.nodeGroups?.includes('模拟') ||
    uiLayout.localizedGraphUi?.glowNodeLabel !== '多层深度辉光' ||
    uiLayout.localizedGraphUi?.glowRadiusLabel !== '辉光半径' ||
    !uiLayout.localizedGraphUi?.portLabels?.includes('粒子点') ||
    !uiLayout.localizedGraphUi?.portTypes?.includes('图像纹理') ||
    uiLayout.graphEditor?.addedNodeCount !== 14 ||
    !uiLayout.graphEditor?.simulationNodeOptions?.includes('simulation.emitter') ||
    !uiLayout.graphEditor?.simulationNodeOptions?.includes('simulation.birth-life') ||
    !uiLayout.graphEditor?.simulationNodeOptions?.includes('simulation.attractor') ||
    !uiLayout.graphEditor?.simulationNodeOptions?.includes('simulation.collision-plane') ||
    !uiLayout.graphEditor?.simulationNodeOptions?.includes('simulation.trail') ||
    uiLayout.graphEditor?.emitterDefaults?.mode !== 'all' ||
    uiLayout.graphEditor?.emitterDefaults?.rate !== 5000 ||
    !uiLayout.graphEditor?.emitterParamKeys?.includes('burstCount') ||
    !uiLayout.graphEditor?.emitterParamKeys?.includes('seed') ||
    !uiLayout.graphEditor?.emitterBypassVisible ||
    uiLayout.graphEditor?.birthLifeDefaults?.lifetimeMin !== 3.96 ||
    uiLayout.graphEditor?.birthLifeDefaults?.lifetimeMax !== 7.04 ||
    !uiLayout.graphEditor?.birthLifeParamKeys?.includes('respawn') ||
    !uiLayout.graphEditor?.birthLifeParamKeys?.includes('fadeOut') ||
    !uiLayout.graphEditor?.birthLifeBypassVisible ||
    uiLayout.graphEditor?.attractorDefaults?.radius !== 4 ||
    uiLayout.graphEditor?.attractorDefaults?.falloff !== 2 ||
    !uiLayout.graphEditor?.attractorParamKeys?.includes('centerX') ||
    !uiLayout.graphEditor?.attractorParamKeys?.includes('strength') ||
    !uiLayout.graphEditor?.attractorBypassVisible ||
    uiLayout.graphEditor?.collisionDefaults?.normalY !== 1 ||
    uiLayout.graphEditor?.collisionDefaults?.restitution !== 0.45 ||
    !uiLayout.graphEditor?.collisionParamKeys?.includes('offset') ||
    !uiLayout.graphEditor?.collisionParamKeys?.includes('friction') ||
    !uiLayout.graphEditor?.collisionBypassVisible ||
    uiLayout.graphEditor?.trailDefaults?.samples !== 4 ||
    uiLayout.graphEditor?.trailDefaults?.interval !== 0.04 ||
    uiLayout.graphEditor?.trailDefaults?.opacity !== 0.38 ||
    !uiLayout.graphEditor?.trailParamKeys?.includes('fade') ||
    !uiLayout.graphEditor?.trailParamKeys?.includes('size') ||
    !uiLayout.graphEditor?.trailBypassVisible ||
    !uiLayout.graphEditor?.addedNodeId ||
    uiLayout.graphEditor?.addedGlowRadius !== 44 ||
    uiLayout.graphEditor?.duplicatedNodeCount !== 15 ||
    uiLayout.graphEditor?.undoNodeCount !== 14 ||
    uiLayout.graphEditor?.redoNodeCount !== 15 ||
    uiLayout.graphEditor?.deletedNodeCount !== 14 ||
    !uiLayout.graphEditor?.directViewportConnection ||
    !uiLayout.graphEditor?.glowDemandSkipped ||
    !uiLayout.graphEditor?.undoRestoredDofConnection ||
    !uiLayout.graphBypassActive ||
    uiLayout.graphBypassMode !== 'graph' ||
    !uiLayout.feedbackResetButtonVisible ||
    uiLayout.feedbackResetAfter !== uiLayout.feedbackResetBefore + 1 ||
    uiLayout.feedbackCreatorControls?.visible ||
    uiLayout.feedbackCreatorControls?.enabled ||
    uiLayout.feedbackCreatorControls?.strength !== 1.1 ||
    uiLayout.feedbackCreatorControls?.turbulence !== 1.3 ||
    uiLayout.feedbackCreatorControls?.drag !== 0.9 ||
    uiLayout.flowStyleCards?.length !== 3 ||
    uiLayout.flowStyleCards?.filter((card) => card.active).length !== 1 ||
    uiLayout.flowStyleCards?.find((card) => card.active)?.style !== 'fluid-ribbon' ||
    uiLayout.flowMotionStatus !== '已静止' ||
    uiLayout.emissionModeRouting?.effectMode !== 'emission' ||
    uiLayout.emissionModeRouting?.activePropertyTab !== 'emission' ||
    uiLayout.emissionModeRouting?.visiblePropertyPage !== 'emission' ||
    uiLayout.emissionModeRouting?.activeModeButton !== 'emission' ||
    !uiLayout.emissionModeRouting?.controlsVisible ||
    uiLayout.dissolveModeRouting?.effectMode !== 'particles' ||
    uiLayout.dissolveModeRouting?.activePropertyTab !== 'dissolve' ||
    uiLayout.dissolveModeRouting?.visiblePropertyPage !== 'dissolve' ||
    uiLayout.videoKeyButtons < 9
  ) {
    throw new Error(`Packaged UI layout regression: ${JSON.stringify(uiLayout)}`);
  }
  const rightResizerStart = await page.evaluate(() => {
    const handle = document.querySelector('.workspace-resizer-right');
    const panel = document.querySelector('.panel');
    const canvas = document.querySelector('#scene');
    const handleRect = handle.getBoundingClientRect();
    return {
      x: handleRect.left + handleRect.width / 2,
      y: handleRect.top + Math.min(180, handleRect.height / 2),
      panelWidth: panel.getBoundingClientRect().width,
      canvasWidth: canvas.getBoundingClientRect().width
    };
  });
  await page.mouse.move(rightResizerStart.x, rightResizerStart.y);
  await page.mouse.down();
  await page.mouse.move(rightResizerStart.x - 72, rightResizerStart.y, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(100);
  const rightResizerEnd = await page.evaluate(() => {
    const panel = document.querySelector('.panel');
    const canvas = document.querySelector('#scene');
    return {
      panelWidth: panel.getBoundingClientRect().width,
      canvasWidth: canvas.getBoundingClientRect().width
    };
  });
  if (
    rightResizerEnd.panelWidth < rightResizerStart.panelWidth + 40 ||
    rightResizerEnd.canvasWidth > rightResizerStart.canvasWidth - 40
  ) {
    throw new Error(`Workspace right resize failed: ${JSON.stringify({ rightResizerStart, rightResizerEnd })}`);
  }
  await page.click('.workspace-reset-layout');
  await page.waitForTimeout(100);
  const resetLayout = await page.evaluate(() => {
    const panel = document.querySelector('.panel');
    const canvas = document.querySelector('#scene');
    return {
      panelWidth: Math.round(panel.getBoundingClientRect().width),
      canvasRightGap: Math.round(window.innerWidth - canvas.getBoundingClientRect().right)
    };
  });
  if (resetLayout.panelWidth < 340 || resetLayout.panelWidth > 380 || resetLayout.canvasRightGap < 340 || resetLayout.canvasRightGap > 380) {
    throw new Error(`Workspace reset layout failed: ${JSON.stringify(resetLayout)}`);
  }
  await page.click('#cameraPreviewHide');
  await page.waitForTimeout(80);
  const previewHidden = await page.evaluate(() => ({
    bodyClass: document.body.classList.contains('camera-preview-hidden'),
    api: window.particleStudio.getCameraPreviewVisible(),
    restoreDisplay: getComputedStyle(document.querySelector('#cameraPreviewRestore')).display
  }));
  if (!previewHidden.bodyClass || previewHidden.api !== false || previewHidden.restoreDisplay === 'none') {
    throw new Error(`Camera preview hide failed: ${JSON.stringify(previewHidden)}`);
  }
  await page.click('#cameraPreviewRestore');
  await page.waitForTimeout(80);
  const previewRestored = await page.evaluate(() => ({
    bodyClass: document.body.classList.contains('camera-preview-hidden'),
    api: window.particleStudio.getCameraPreviewVisible(),
    restoreDisplay: getComputedStyle(document.querySelector('#cameraPreviewRestore')).display
  }));
  if (previewRestored.bodyClass || previewRestored.api !== true || previewRestored.restoreDisplay !== 'none') {
    throw new Error(`Camera preview restore failed: ${JSON.stringify(previewRestored)}`);
  }
  await page.screenshot({ path: uiScreenshotPath, type: 'png' });
  await page.evaluate(() => {
    const properties = document.querySelector('.workspace-properties-pane') || document.querySelector('.panel');
    properties.scrollTop = properties.scrollHeight;
  });
  await page.screenshot({ path: uiCameraScreenshotPath, type: 'png' });
  await page.evaluate(() => {
    const properties = document.querySelector('.workspace-properties-pane') || document.querySelector('.panel');
    properties.scrollTop = 0;
  });
  await page.click('[data-workspace-mode="graph"]');
  await page.click('[data-node-type="simulation.force-field"]');
  await page.click('#operatorGraphPreviewExecution');
  await page.screenshot({ path: uiGraphScreenshotPath, type: 'png' });
  await page.click('[data-workspace-mode="layout"]');
  const result = await page.evaluate(async () => {
    const hasElectronBridge = Boolean(window.electronAPI?.exportMov);
    const lowQuality = window.particleStudio.setQualityMode('low', { persist: false });
    const highQuality = window.particleStudio.setQualityMode('high', { persist: false });
    const initialCamera = window.particleStudio.getCameraSettings();
    const camerasBefore = window.particleStudio.getSceneCameras();
    const addedCamera = window.particleStudio.addSceneCamera();
    const camerasAfterAdd = window.particleStudio.getSceneCameras();
    window.particleStudio.toggleSceneCameraHidden(addedCamera.id);
    const camerasAfterHide = window.particleStudio.getSceneCameras();
    const sceneModelsBefore = window.particleStudio.getSceneModels();
    const firstModelId = sceneModelsBefore?.models?.[0]?.id;
    let collectionResult = null;
    if (firstModelId) {
      window.particleStudio.selectSceneModelIdsForTest([firstModelId]);
      const collection = window.particleStudio.addSceneModelCollectionForTest('Smoke Collection');
      window.particleStudio.assignSelectedSceneModelsToCollectionForTest(collection.id);
      collectionResult = window.particleStudio.getSceneModels();
    }

    window.particleStudio.setCameraSettings({ displaySize: 2.5 });
    document.querySelector('#addKeyframe')?.click();
    document.querySelector('#scaleKeyframe')?.click();
    const cameraSize = window.particleStudio.getTransformSelectionDebug();

    window.particleStudio.setExportResolution(320, 160, 2);
    window.particleStudio.setCameraSettings({ type: 'panorama' });
    const panoramaFrame = window.particleStudio.renderFrame(0, undefined, 0);
    const panoramaSize = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve([image.naturalWidth, image.naturalHeight]);
      image.onerror = reject;
      image.src = panoramaFrame;
    });

    window.particleStudio.setCameraSettings({
      type: 'perspective',
      dofEnabled: true,
      aperture: 1.8,
      focusDistance: 1.5,
      bokehScale: 3.2,
      highlightGain: 1.1,
      blades: 9,
      roundness: 0.64
    });
    const dofCameraSettings = window.particleStudio.getCameraSettings();
    const dofFrameBytes = window.particleStudio.renderFrame(0, undefined, 0).length;
    const operatorRuntime = window.particleStudio.getOperatorRuntimeStats();

    window.particleStudio.setParameterKeyframes([]);
    window.particleStudio.setCameraKeyframes([]);
    await window.particleStudio.setOptions({ dissolve: 0.2 }, true);
    window.particleStudio.checkpointUndo('electron smoke');
    await window.particleStudio.setOptions({ dissolve: 0.8 }, true);
    await window.particleStudio.undo();

    return {
      href: location.href,
      hasElectronBridge,
      quality: { low: lowQuality, high: highQuality },
      initialCamera,
      camerasBefore: camerasBefore.items.length,
      camerasAfterAdd: camerasAfterAdd.items.length,
      addedCameraActive: camerasAfterAdd.activeId === addedCamera.id,
      addedCameraHidden: camerasAfterHide.items.find((item) => item.id === addedCamera.id)?.hidden,
      collectionCount: collectionResult?.collections?.length || 0,
      groupedModelId: collectionResult?.models?.find((item) => item.id === firstModelId)?.collectionId || '',
      cameraSize,
      panoramaSize,
      panoramaBytes: panoramaFrame.length,
      dofFrameBytes,
      dofCameraSettings,
      operatorRuntime,
      undoDissolve: window.particleStudio.getOptions().dissolve,
      status: document.querySelector('#status')?.textContent || ''
    };
  });

  if (!result.hasElectronBridge) {
    throw new Error('Electron preload bridge is unavailable.');
  }
  if (result.panoramaSize[0] !== 320 || result.panoramaSize[1] !== 160 || result.panoramaBytes < 1000) {
    throw new Error(`Panorama frame failed: ${JSON.stringify(result)}`);
  }
  if (result.dofFrameBytes < 1000) {
    throw new Error(`Depth-of-field frame failed: ${JSON.stringify(result)}`);
  }
  if (
    Math.abs(result.dofCameraSettings?.bokehScale - 3.2) > 0.001 ||
    Math.abs(result.dofCameraSettings?.highlightGain - 1.1) > 0.001 ||
    result.dofCameraSettings?.blades !== 9 ||
    Math.abs(result.dofCameraSettings?.roundness - 0.64) > 0.001
  ) {
    throw new Error(`Depth-of-field camera controls failed: ${JSON.stringify(result.dofCameraSettings)}`);
  }
  if (
    result.operatorRuntime?.scope !== 'export-frame' ||
    result.operatorRuntime?.error ||
    !result.operatorRuntime?.executedNodeIds?.includes('viewport-output') ||
    !result.operatorRuntime?.timings?.some((item) => item.nodeId === 'multi-glow') ||
    result.operatorRuntime?.resources?.passCount !== 11 ||
    result.operatorRuntime?.resources?.poolCount !== 1 ||
    result.operatorRuntime?.resources?.pools?.[0]?.entryCount !== 9 ||
    result.operatorRuntime?.resources?.pools?.[0]?.reuses !== 5 ||
    result.operatorRuntime?.resources?.pools?.[0]?.allocations !== 0 ||
    result.operatorRuntime?.resources?.pools?.[0]?.releases !== 5 ||
    result.operatorRuntime?.resources?.pools?.[0]?.peakActiveLeases !== 5 ||
    result.operatorRuntime?.resources?.pools?.[0]?.activeLeaseCount !== 0 ||
    result.operatorRuntime?.resources?.lifetime?.managedResourceCount !== 3 ||
    result.operatorRuntime?.resources?.lifetime?.aliasPublications !== 1 ||
    result.operatorRuntime?.resources?.lifetime?.releases !== 3 ||
    result.operatorRuntime?.resources?.lifetime?.activeResourceCount !== 0 ||
    !result.operatorRuntime?.resources?.resources?.some((item) => (
      item.kind === 'points' && item.producerNodeId === 'flow-dissolve' && item.count > 0
    )) ||
    !result.operatorRuntime?.resources?.resources?.some((item) => item.kind === 'depth') ||
    !result.operatorRuntime?.resources?.resources?.some((item) => (
      item.metadata?.stage === 'depth-of-field' &&
      item.metadata?.lensModel === 'thin-lens-signed-coc' &&
      item.metadata?.samples === 48 &&
      Math.abs(item.metadata?.bokehScale - 3.2) < 0.001 &&
      Math.abs(item.metadata?.highlightGain - 1.1) < 0.001 &&
      item.metadata?.blades === 9 &&
      Math.abs(item.metadata?.roundness - 0.64) < 0.001 &&
      item.metadata?.prefilterRadiusPixels > 0 &&
      item.metadata?.resolveRadiusPixels >= 2
    )) ||
    result.operatorRuntime?.resources?.passes?.map((item) => item.type).join(',') !==
      'geometry.particle-sampler,simulation.dissolve,simulation.force-field,simulation.return-force,simulation.emitter,simulation.birth-life,simulation.feedback-particles,render.particles,post.glow,post.depth-of-field,output.viewport'
  ) {
    throw new Error(`Operator runtime did not execute the Electron render frame: ${JSON.stringify(result.operatorRuntime)}`);
  }
  if (
    result.quality.low.level !== 'low' || result.quality.low.profile.glowLayers !== 1 || result.quality.low.profile.dofSamples !== 12 ||
    result.quality.high.level !== 'high' || result.quality.high.profile.glowLayers !== 3 || result.quality.high.profile.dofSamples !== 48
  ) {
    throw new Error(`Electron quality profiles failed: ${JSON.stringify(result.quality)}`);
  }
  if (
    result.camerasBefore < 1 ||
    result.camerasAfterAdd < result.camerasBefore + 1 ||
    !result.addedCameraActive ||
    result.addedCameraHidden !== true ||
    result.collectionCount < 1 ||
    !result.groupedModelId
  ) {
    throw new Error(`Scene cameras / collections failed: ${JSON.stringify(result)}`);
  }
  if (
    Math.abs(result.cameraSize?.cameraDisplaySize - 2.5) > 0.01 ||
    Math.abs(result.cameraSize?.cameraMarkerScale?.[0] - 2.5) > 0.01 ||
    result.cameraSize?.keyframeMode !== 'scale'
  ) {
    throw new Error(`Camera display size control failed: ${JSON.stringify(result.cameraSize)}`);
  }
  if (Math.abs(result.undoDissolve - 0.2) > 0.01) {
    throw new Error(`Undo failed: ${JSON.stringify(result)}`);
  }

  const modalPoint = await page.evaluate(() => {
    const canvas = document.querySelector('#scene');
    const rect = canvas.getBoundingClientRect();
    return {
      x: rect.left + rect.width * 0.58,
      y: rect.top + rect.height * 0.52
    };
  });
  const packagedModalStart = await page.evaluate(() => {
    window.particleStudio.setCameraKeyframes([
      { id: 'electron-modal-camera', time: 0, position: [0, 0.7, 7.2], target: [0, 0, 0] }
    ]);
    window.particleStudio.selectCameraKeyframeForTest(0);
    document.activeElement?.blur?.();
    return window.particleStudio.getTransformSelectionDebug();
  });
  await page.mouse.move(modalPoint.x, modalPoint.y);
  await page.keyboard.press('KeyG');
  const packagedModalDuring = await page.evaluate(() => window.particleStudio.getTransformSelectionDebug());
  await page.keyboard.press('KeyX');
  await page.mouse.move(modalPoint.x + 100, modalPoint.y + 40, { steps: 4 });
  const packagedModalConstrained = await page.evaluate(() => window.particleStudio.getTransformSelectionDebug());
  await page.mouse.click(modalPoint.x + 100, modalPoint.y + 40);
  const packagedModalEnd = await page.evaluate(() => window.particleStudio.getTransformSelectionDebug());
  const packagedXMove = Math.abs(packagedModalEnd.proxyPosition[0] - packagedModalStart.proxyPosition[0]);
  const packagedYDrift = Math.abs(packagedModalEnd.proxyPosition[1] - packagedModalStart.proxyPosition[1]);
  const packagedZDrift = Math.abs(packagedModalEnd.proxyPosition[2] - packagedModalStart.proxyPosition[2]);
  if (
    packagedModalDuring.modalTransform?.mode !== 'translate' ||
    packagedModalDuring.modalTransform?.target !== 'camera' ||
    packagedModalConstrained.axisConstraint?.axis !== 'x' ||
    packagedModalConstrained.axisConstraint?.mode !== 'only' ||
    packagedXMove < 0.005 ||
    packagedYDrift > 0.001 ||
    packagedZDrift > 0.001
  ) {
    throw new Error(`Packaged modal transform failed: ${JSON.stringify({
      packagedModalStart,
      packagedModalDuring,
      packagedModalConstrained,
      packagedModalEnd,
      packagedXMove,
      packagedYDrift,
      packagedZDrift
    })}`);
  }

  const movProxyResult = await page.evaluate(async (assetPath) => {
    const ipcProxy = await window.electronAPI.prepareVideoProxy({
      path: assetPath,
      extension: 'mov',
      name: 'electron-video-alpha-smoke.mov'
    });
    await window.particleStudio.setVideoPlanes({
      activeId: 'electron-mov-proxy-smoke',
      items: [
        {
          id: 'electron-mov-proxy-smoke',
          name: 'electron-video-alpha-smoke.mov',
          extension: 'mov',
          path: assetPath,
          width: 1.8,
          height: 1.8,
          opacity: 0.9,
          playbackRate: 1,
          loop: true,
          transform: { position: [0, 0.5, 0.25], rotation: [0, 180, 0], scale: [1, 1, 1] }
        }
      ]
    });
    window.particleStudio.addVideoPlaneKeyframe('width');
    window.particleStudio.addVideoPlaneKeyframe('position');
    window.particleStudio.addVideoPlaneKeyframe('uniformScale');
    const videoKeyframes = window.particleStudio.getVideoPlaneKeyframes();
    const asset = window.particleStudio.getCurrentAsset().videoPlanes.find((item) => item.id === 'electron-mov-proxy-smoke');
    const frame = await window.particleStudio.renderFrameAsync(0, undefined, 0);
    return {
      ipcProxy: {
        ok: ipcProxy?.ok,
        extension: ipcProxy?.extension,
        url: ipcProxy?.url,
        size: ipcProxy?.size,
        cached: Boolean(ipcProxy?.cached)
      },
      asset,
      videoKeyframes,
      frameBytes: frame.length,
      status: document.querySelector('#videoPlaneStatus')?.value || ''
    };
  }, movAssetSmokePath);
  if (
    !movProxyResult.ipcProxy?.ok ||
    movProxyResult.ipcProxy.extension !== 'webm' ||
    !movProxyResult.ipcProxy.url?.startsWith('/__runtime-asset/') ||
    movProxyResult.ipcProxy.size < 100 ||
    !movProxyResult.asset?.hasProxy ||
    !movProxyResult.asset?.proxyCached ||
    movProxyResult.asset.playbackExtension !== 'webm' ||
    movProxyResult.videoKeyframes?.length < 3 ||
    !movProxyResult.videoKeyframes?.some((keyframe) => keyframe.track === 'uniformScale') ||
    movProxyResult.frameBytes < 1000
  ) {
    throw new Error(`MOV proxy import failed: ${JSON.stringify(movProxyResult)}`);
  }
  result.movProxy = movProxyResult;

  const projectResult = await page.evaluate(async () => {
    await window.particleStudio.setOptions({ dissolve: 0.37, spread: 1.23 }, true);
    window.particleStudio.setCameraSettings({
      displaySize: 1.75,
      focalLength: 70,
      bokehScale: 3.4,
      highlightGain: 1.3,
      blades: 8,
      roundness: 0.58
    });
    window.particleStudio.setCameraPathMode('bezier');
    window.particleStudio.setCameraKeyframes([
      { id: 'project-camera', time: 0, position: [0, 0.7, 7.2], target: [0, 0, 0], handleOut: [0.5, 0.25, 0] }
    ]);
    window.particleStudio.setParameterKeyframes([
      { id: 'project-param', field: 'noise', time: 1, value: 0.64 }
    ]);
    window.particleStudio.setCameraTime(0, false);
    const customGraph = window.particleStudio.getOperatorGraph();
    customGraph.metadata = { ...customGraph.metadata, mode: 'graph', synchronized: false };
    const customDissolveNode = customGraph.nodes.find((node) => node.type === 'simulation.dissolve');
    customDissolveNode.params = {
      ...customDissolveNode.params,
      dissolve: 0.58,
      speed: 1,
      dissolveTurbulence: 1.4,
      dissolveCurl: 1.8
    };
    const customForceNode = customGraph.nodes.find((node) => node.type === 'simulation.force-field');
    customForceNode.params = {
      ...customForceNode.params,
      strength: 1.4,
      forceX: 0.15,
      forceY: 0.25,
      forceZ: -0.05,
      turbulence: 2.1,
      curl: 1.3
    };
    const customReturnForceNode = customGraph.nodes.find((node) => node.type === 'simulation.return-force');
    customReturnForceNode.params = { ...customReturnForceNode.params, strength: -0.35 };
    const customEmitterNode = customGraph.nodes.find((node) => node.type === 'simulation.emitter');
    customEmitterNode.params = {
      ...customEmitterNode.params,
      mode: 'continuous',
      rate: 12000,
      seed: 23,
      speed: 0.6,
      spread: 0.3
    };
    const customBirthLifeNode = customGraph.nodes.find((node) => node.type === 'simulation.birth-life');
    customBirthLifeNode.params = {
      ...customBirthLifeNode.params,
      lifetimeMin: 1.5,
      lifetimeMax: 4.5,
      respawn: false,
      fadeIn: 0.05,
      fadeOut: 0.4
    };
    customGraph.nodes.push(
      {
        id: 'project-attractor',
        type: 'simulation.attractor',
        label: 'Project Attractor',
        position: { x: 980, y: 260 },
        params: {
          enabled: true,
          centerX: 0.6,
          centerY: 0.2,
          centerZ: -0.1,
          strength: 2.4,
          radius: 3.5,
          falloff: 1.4
        }
      },
      {
        id: 'project-collision',
        type: 'simulation.collision-plane',
        label: 'Project Collision',
        position: { x: 1200, y: 260 },
        params: {
          enabled: true,
          normalX: 0,
          normalY: 1,
          normalZ: 0,
          offset: -0.4,
          restitution: 0.7,
          friction: 0.22
        }
      },
      {
        id: 'project-trail',
        type: 'simulation.trail',
        label: 'Project Trail',
        position: { x: 1420, y: 260 },
        params: {
          enabled: true,
          samples: 5,
          interval: 0.03,
          opacity: 0.44,
          fade: 1.8,
          size: 0.66
        }
      }
    );
    customGraph.edges = customGraph.edges.filter((edge) => edge.id !== 'return-to-emitter');
    customGraph.edges.push(
      {
        id: 'project-return-to-attractor',
        from: { node: 'particle-return', port: 'points' },
        to: { node: 'project-attractor', port: 'points' }
      },
      {
        id: 'project-attractor-to-collision',
        from: { node: 'project-attractor', port: 'points' },
        to: { node: 'project-collision', port: 'points' }
      },
      {
        id: 'project-collision-to-trail',
        from: { node: 'project-collision', port: 'points' },
        to: { node: 'project-trail', port: 'points' }
      },
      {
        id: 'project-trail-to-emitter',
        from: { node: 'project-trail', port: 'points' },
        to: { node: 'particle-emitter', port: 'points' }
      }
    );
    const customFeedbackNode = customGraph.nodes.find((node) => node.type === 'simulation.feedback-particles');
    customFeedbackNode.params = {
      ...customFeedbackNode.params,
      enabled: true,
      resetVersion: 7,
      strength: 1.23,
      turbulence: 0.2,
      substeps: 4
    };
    window.particleStudio.setOperatorGraph(customGraph);
    const before = window.particleStudio.captureProject();
    const save = await window.electronAPI.saveProject({
      document: before,
      suggestedName: 'electron-project-smoke',
      saveAs: true
    });

    await window.particleStudio.setOptions({ dissolve: 0.91, spread: 0.12 }, true);
    window.particleStudio.setCameraSettings({ displaySize: 0.5, focalLength: 18 });
    window.particleStudio.setCameraPathMode('linear');
    window.particleStudio.setCameraKeyframes([]);
    window.particleStudio.setParameterKeyframes([]);

    const opened = await window.electronAPI.openProject();
    await window.particleStudio.applyProject(opened.document);
    const after = window.particleStudio.captureProject();
    window.particleStudio.renderFrame(0, undefined, 0);
    window.particleStudio.renderFrame(0.12, undefined, 0);
    const restoredFrame = window.particleStudio.renderFrame(0.24, undefined, 0);
    const restoredRuntime = window.particleStudio.getOperatorRuntimeStats();
    const restoredDissolveNode = after.operatorGraph?.nodes?.find((node) => node.type === 'simulation.dissolve');
    const restoredForceNode = after.operatorGraph?.nodes?.find((node) => node.type === 'simulation.force-field');
    const restoredReturnForceNode = after.operatorGraph?.nodes?.find((node) => node.type === 'simulation.return-force');
    const restoredEmitterNode = after.operatorGraph?.nodes?.find((node) => node.type === 'simulation.emitter');
    const restoredBirthLifeNode = after.operatorGraph?.nodes?.find((node) => node.type === 'simulation.birth-life');
    const restoredAttractorNode = after.operatorGraph?.nodes?.find((node) => node.type === 'simulation.attractor');
    const restoredCollisionNode = after.operatorGraph?.nodes?.find((node) => node.type === 'simulation.collision-plane');
    const restoredTrailNode = after.operatorGraph?.nodes?.find((node) => node.type === 'simulation.trail');
    const restoredFeedbackNode = after.operatorGraph?.nodes?.find((node) => node.type === 'simulation.feedback-particles');
    const restoredFeedbackResource = restoredRuntime.resources?.resources?.find((resource) => (
      resource.producerNodeId === 'particle-feedback' && resource.kind === 'points'
    ));
    return {
      save: { ok: save.ok, name: save.name, bytes: save.bytes },
      opened: { ok: opened.ok, name: opened.name },
      format: after.format,
      dissolve: after.scene.options.dissolve,
      spread: after.scene.options.spread,
      displaySize: after.scene.cameraSettings.displaySize,
      focalLength: after.scene.cameraSettings.focalLength,
      bokehScale: after.scene.cameraSettings.bokehScale,
      highlightGain: after.scene.cameraSettings.highlightGain,
      blades: after.scene.cameraSettings.blades,
      roundness: after.scene.cameraSettings.roundness,
      pathMode: after.scene.cameraAnimation.pathMode,
      handleOut: after.scene.cameraKeyframes[0]?.handleOut,
      cameraKeyframes: after.scene.cameraKeyframes.length,
      parameterKeyframes: after.scene.parameterKeyframes.length,
      operatorGraph: {
        schemaVersion: after.operatorGraph?.schemaVersion,
        nodes: after.operatorGraph?.nodes?.length || 0,
        edges: after.operatorGraph?.edges?.length || 0,
        valid: window.particleStudio.validateOperatorGraph(after.operatorGraph).valid,
        executionTail: window.particleStudio.getOperatorExecutionPlan().order.at(-1),
        mode: after.operatorGraph?.metadata?.mode,
        dissolve: restoredDissolveNode?.params?.dissolve,
        turbulence: restoredDissolveNode?.params?.dissolveTurbulence,
        curl: restoredDissolveNode?.params?.dissolveCurl,
        forceStrength: restoredForceNode?.params?.strength,
        forceTurbulence: restoredForceNode?.params?.turbulence,
        forceY: restoredForceNode?.params?.forceY,
        returnStrength: restoredReturnForceNode?.params?.strength,
        emitterMode: restoredEmitterNode?.params?.mode,
        emitterRate: restoredEmitterNode?.params?.rate,
        emitterSeed: restoredEmitterNode?.params?.seed,
        emitterSpeed: restoredEmitterNode?.params?.speed,
        lifetimeMin: restoredBirthLifeNode?.params?.lifetimeMin,
        lifetimeMax: restoredBirthLifeNode?.params?.lifetimeMax,
        respawn: restoredBirthLifeNode?.params?.respawn,
        attractorStrength: restoredAttractorNode?.params?.strength,
        attractorRadius: restoredAttractorNode?.params?.radius,
        collisionOffset: restoredCollisionNode?.params?.offset,
        collisionRestitution: restoredCollisionNode?.params?.restitution,
        trailSamples: restoredTrailNode?.params?.samples,
        trailInterval: restoredTrailNode?.params?.interval,
        trailOpacity: restoredTrailNode?.params?.opacity,
        feedbackResetVersion: restoredFeedbackNode?.params?.resetVersion,
        feedbackStrength: restoredFeedbackNode?.params?.strength,
        feedbackTurbulence: restoredFeedbackNode?.params?.turbulence,
        feedbackSubsteps: restoredFeedbackNode?.params?.substeps,
        effectiveModifierCount: restoredFeedbackResource?.metadata?.simulationModifierCount,
        effectiveAttractorCount: restoredFeedbackResource?.metadata?.attractorCount,
        effectiveCollisionPlaneCount: restoredFeedbackResource?.metadata?.collisionPlaneCount,
        effectiveTrailHistorySamples: restoredFeedbackResource?.metadata?.trailHistorySamples,
        effectiveTrailHistoryCapacity: restoredFeedbackResource?.metadata?.trailHistoryCapacity,
        effectiveTrailByteLength: restoredFeedbackResource?.metadata?.trailByteLength,
        stateSpace: restoredFeedbackResource?.metadata?.stateSpace,
        lifecycleTimeModel: restoredFeedbackResource?.metadata?.lifecycleTimeModel,
        lifecycleSeekDeterministic: restoredFeedbackResource?.metadata?.lifecycleSeekDeterministic,
        effectiveEmitterMode: restoredFeedbackResource?.metadata?.emitterMode,
        effectiveEmitterNodeId: restoredFeedbackResource?.metadata?.emitterNodeId,
        effectiveBirthLifeNodeId: restoredFeedbackResource?.metadata?.birthLifeNodeId,
        effectiveForceY: restoredFeedbackResource?.metadata?.effectiveForce?.[1],
        effectiveAttraction: restoredFeedbackResource?.metadata?.effectiveAttraction,
        effectiveTurbulence: restoredFeedbackResource?.metadata?.effectiveTurbulence
      },
      restoredFrameBytes: restoredFrame.length,
      restoredPointDissolve: restoredRuntime.resources?.resources?.find((resource) => (
        resource.producerNodeId === 'flow-dissolve' && resource.kind === 'points'
      ))?.metadata?.dissolve
    };
  });
  const savedProject = JSON.parse(await readFile(projectSmokePath, 'utf8'));
  const embeddedModel = savedProject.scene?.sceneModels?.models?.find((model) => model.dataUrl);
  if (
    !projectResult.save.ok ||
    !projectResult.opened.ok ||
    projectResult.format !== 'particle-model-studio-project' ||
    Math.abs(projectResult.dissolve - 0.37) > 0.01 ||
    Math.abs(projectResult.spread - 1.23) > 0.01 ||
    Math.abs(projectResult.displaySize - 1.75) > 0.01 ||
    Math.abs(projectResult.focalLength - 70) > 0.01 ||
    Math.abs(projectResult.bokehScale - 3.4) > 0.001 ||
    Math.abs(projectResult.highlightGain - 1.3) > 0.001 ||
    projectResult.blades !== 8 ||
    Math.abs(projectResult.roundness - 0.58) > 0.001 ||
    projectResult.pathMode !== 'bezier' ||
    Math.abs(Number(projectResult.handleOut?.[0] || 0) - 0.5) > 0.001 ||
    projectResult.cameraKeyframes !== 1 ||
    projectResult.parameterKeyframes !== 1 ||
    projectResult.operatorGraph.schemaVersion !== 1 ||
    projectResult.operatorGraph.nodes !== 16 ||
    projectResult.operatorGraph.edges !== 17 ||
    !projectResult.operatorGraph.valid ||
    projectResult.operatorGraph.executionTail !== 'viewport-output' ||
    projectResult.operatorGraph.mode !== 'graph' ||
    Math.abs(projectResult.operatorGraph.dissolve - 0.58) > 0.001 ||
    Math.abs(projectResult.operatorGraph.turbulence - 1.4) > 0.001 ||
    Math.abs(projectResult.operatorGraph.curl - 1.8) > 0.001 ||
    Math.abs(projectResult.operatorGraph.forceStrength - 1.4) > 0.001 ||
    Math.abs(projectResult.operatorGraph.forceTurbulence - 2.1) > 0.001 ||
    Math.abs(projectResult.operatorGraph.forceY - 0.25) > 0.001 ||
    Math.abs(projectResult.operatorGraph.returnStrength + 0.35) > 0.001 ||
    projectResult.operatorGraph.emitterMode !== 'continuous' ||
    projectResult.operatorGraph.emitterRate !== 12000 ||
    projectResult.operatorGraph.emitterSeed !== 23 ||
    Math.abs(projectResult.operatorGraph.emitterSpeed - 0.6) > 0.001 ||
    Math.abs(projectResult.operatorGraph.lifetimeMin - 1.5) > 0.001 ||
    Math.abs(projectResult.operatorGraph.lifetimeMax - 4.5) > 0.001 ||
    projectResult.operatorGraph.respawn !== false ||
    Math.abs(projectResult.operatorGraph.attractorStrength - 2.4) > 0.001 ||
    Math.abs(projectResult.operatorGraph.attractorRadius - 3.5) > 0.001 ||
    Math.abs(projectResult.operatorGraph.collisionOffset + 0.4) > 0.001 ||
    Math.abs(projectResult.operatorGraph.collisionRestitution - 0.7) > 0.001 ||
    projectResult.operatorGraph.trailSamples !== 5 ||
    Math.abs(projectResult.operatorGraph.trailInterval - 0.03) > 0.001 ||
    Math.abs(projectResult.operatorGraph.trailOpacity - 0.44) > 0.001 ||
    projectResult.operatorGraph.feedbackResetVersion !== 7 ||
    Math.abs(projectResult.operatorGraph.feedbackStrength - 1.23) > 0.001 ||
    Math.abs(projectResult.operatorGraph.feedbackTurbulence - 0.2) > 0.001 ||
    projectResult.operatorGraph.feedbackSubsteps !== 4 ||
    projectResult.operatorGraph.effectiveModifierCount !== 7 ||
    projectResult.operatorGraph.effectiveAttractorCount !== 1 ||
    projectResult.operatorGraph.effectiveCollisionPlaneCount !== 1 ||
    projectResult.operatorGraph.effectiveTrailHistorySamples !== 5 ||
    projectResult.operatorGraph.effectiveTrailHistoryCapacity !== 5 ||
    projectResult.operatorGraph.effectiveTrailByteLength <= 0 ||
    projectResult.operatorGraph.stateSpace !== 'model-local-position' ||
    projectResult.operatorGraph.lifecycleTimeModel !== 'absolute-cycle-v1' ||
    projectResult.operatorGraph.lifecycleSeekDeterministic !== true ||
    projectResult.operatorGraph.effectiveEmitterMode !== 'continuous' ||
    projectResult.operatorGraph.effectiveEmitterNodeId !== 'particle-emitter' ||
    projectResult.operatorGraph.effectiveBirthLifeNodeId !== 'particle-birth-life' ||
    Math.abs(projectResult.operatorGraph.effectiveForceY - 0.35) > 0.001 ||
    Math.abs(projectResult.operatorGraph.effectiveAttraction + 0.35) > 0.001 ||
    Math.abs(projectResult.operatorGraph.effectiveTurbulence - 3.14) > 0.001 ||
    Math.abs(projectResult.restoredPointDissolve - 0.58) > 0.001 ||
    projectResult.restoredFrameBytes < 1000 ||
    savedProject.operatorGraph?.nodes?.length !== 16 ||
    savedProject.operatorGraph?.edges?.length !== 17 ||
    Math.abs(savedProject.operatorGraph?.nodes?.find((node) => node.type === 'simulation.dissolve')?.params?.dissolve - 0.58) > 0.001 ||
    Math.abs(savedProject.operatorGraph?.nodes?.find((node) => node.type === 'simulation.force-field')?.params?.strength - 1.4) > 0.001 ||
    Math.abs(savedProject.operatorGraph?.nodes?.find((node) => node.type === 'simulation.return-force')?.params?.strength + 0.35) > 0.001 ||
    savedProject.operatorGraph?.nodes?.find((node) => node.type === 'simulation.emitter')?.params?.mode !== 'continuous' ||
    savedProject.operatorGraph?.nodes?.find((node) => node.type === 'simulation.emitter')?.params?.rate !== 12000 ||
    Math.abs(savedProject.operatorGraph?.nodes?.find((node) => node.type === 'simulation.birth-life')?.params?.lifetimeMin - 1.5) > 0.001 ||
    Math.abs(savedProject.operatorGraph?.nodes?.find((node) => node.type === 'simulation.attractor')?.params?.strength - 2.4) > 0.001 ||
    Math.abs(savedProject.operatorGraph?.nodes?.find((node) => node.type === 'simulation.collision-plane')?.params?.offset + 0.4) > 0.001 ||
    savedProject.operatorGraph?.nodes?.find((node) => node.type === 'simulation.trail')?.params?.samples !== 5 ||
    Math.abs(savedProject.operatorGraph?.nodes?.find((node) => node.type === 'simulation.feedback-particles')?.params?.strength - 1.23) > 0.001 ||
    !embeddedModel
  ) {
    throw new Error(`Project save/open roundtrip failed: ${JSON.stringify({ projectResult, embeddedModel: Boolean(embeddedModel) })}`);
  }
  const uiSaveToast = await page.evaluate(async () => {
    const result = await window.particleStudio.saveProject(true);
    await new Promise((resolve) => setTimeout(resolve, 120));
    const toast = document.querySelector('.app-toast');
    return {
      ok: result?.ok,
      text: toast?.textContent || '',
      visible: Boolean(toast?.classList.contains('visible') || (result?.ok && toast?.textContent))
    };
  });
  if (!uiSaveToast.ok || !uiSaveToast.visible || !uiSaveToast.text.includes('工程已保存')) {
    throw new Error(`Project save toast failed: ${JSON.stringify(uiSaveToast)}`);
  }
  projectResult.uiSaveToast = uiSaveToast.text;
  result.project = projectResult;
  await rm(projectSmokePath, { force: true });

  const streamedSaveResult = await page.evaluate(async (assetPath) => {
    const document = window.particleStudio.captureProject();
    document.scene.sceneModels = null;
    document.scene.model = null;
    document.scene.morphTarget = null;
    document.scene.world = null;
    document.scene.imageSplat = {
      name: 'electron-streamed-asset-smoke.ply',
      extension: 'ply',
      path: assetPath,
      size: 8 * 1024 * 1024,
      kind: 'gaussian'
    };
    return window.electronAPI.saveProject({
      document,
      suggestedName: 'electron-streamed-project-smoke',
      saveAs: true
    });
  }, streamedAssetSmokePath);
  const streamedProject = JSON.parse(await readFile(streamedProjectSmokePath, 'utf8'));
  const streamedAsset = streamedProject.scene?.imageSplat;
  if (
    !streamedSaveResult?.ok ||
    streamedSaveResult.bytes < 10 * 1024 * 1024 ||
    !streamedAsset?.dataUrl?.startsWith('data:application/octet-stream;base64,Wlpa') ||
    streamedAsset.sourcePath !== streamedAssetSmokePath
  ) {
    throw new Error(`Streamed project asset save failed: ${JSON.stringify({
      streamedSaveResult,
      hasDataUrl: Boolean(streamedAsset?.dataUrl),
      sourcePath: streamedAsset?.sourcePath
    })}`);
  }
  result.streamedProject = {
    bytes: streamedSaveResult.bytes,
    sourceBytes: 8 * 1024 * 1024,
    embedded: true
  };

  const videoSaveResult = await page.evaluate(async (assetPath) => {
    const document = window.particleStudio.captureProject();
    document.scene.sceneModels = null;
    document.scene.model = null;
    document.scene.morphTarget = null;
    document.scene.world = null;
    document.scene.imageSplat = null;
    document.scene.videoPlanes = {
      activeId: 'electron-video-smoke',
      items: [
        {
          id: 'electron-video-smoke',
          name: 'electron-video-asset-smoke.mp4',
          extension: 'mp4',
          path: assetPath,
          size: 24,
          width: 2.4,
          height: 1.35,
          opacity: 0.85,
          playbackRate: 1,
          loop: true,
          transform: { position: [0, 0.5, 0.25], rotation: [0, 180, 0], scale: [1, 1, 1] }
        }
      ]
    };
    return window.electronAPI.saveProject({
      document,
      suggestedName: 'electron-video-project-smoke',
      saveAs: true
    });
  }, videoAssetSmokePath);
  const videoProject = JSON.parse(await readFile(videoProjectSmokePath, 'utf8'));
  const savedVideo = videoProject.scene?.videoPlanes?.items?.[0];
  if (
    !videoSaveResult?.ok ||
    !savedVideo?.dataUrl?.startsWith('data:video/mp4;base64,') ||
    savedVideo.sourcePath !== videoAssetSmokePath ||
    Math.abs(savedVideo.opacity - 0.85) > 0.001
  ) {
    throw new Error(`Video project asset save failed: ${JSON.stringify({
      videoSaveResult,
      hasDataUrl: Boolean(savedVideo?.dataUrl),
      sourcePath: savedVideo?.sourcePath,
      opacity: savedVideo?.opacity
    })}`);
  }
  result.videoProject = {
    bytes: videoSaveResult.bytes,
    embedded: true,
    mime: savedVideo.dataUrl.slice(0, 14)
  };

  const missingAssetResult = await page.evaluate(async () => {
    const document = window.particleStudio.captureProject();
    document.scene.sceneModels = null;
    document.scene.model = null;
    document.scene.morphTarget = null;
    document.scene.world = null;
    document.scene.imageSplat = {
      name: 'missing-asset.ply',
      extension: 'ply',
      path: 'Z:\\particle-model-studio-missing\\missing-asset.ply',
      kind: 'gaussian'
    };
    return window.electronAPI.saveProject({
      document,
      suggestedName: 'electron-missing-project-smoke',
      saveAs: true
    });
  });
  if (
    missingAssetResult?.ok ||
    missingAssetResult?.code !== 'PROJECT_ASSET_MISSING' ||
    !String(missingAssetResult?.error || '').includes('missing-asset.ply')
  ) {
    throw new Error(`Missing project asset error was not reported: ${JSON.stringify(missingAssetResult)}`);
  }
  result.missingAssetError = missingAssetResult.error;
  await rm(streamedProjectSmokePath, { force: true });
  await rm(streamedAssetSmokePath, { force: true });
  await rm(videoProjectSmokePath, { force: true });
  await rm(videoAssetSmokePath, { force: true });

  const recoveryResult = await page.evaluate(async () => {
    const document = window.particleStudio.captureRecoveryProject();
    document.scene.sceneModels = null;
    document.scene.model = null;
    document.scene.morphTarget = null;
    document.scene.world = null;
    document.scene.imageSplat = null;
    return window.electronAPI.saveProjectRecovery({
      document,
      suggestedName: 'electron-recovery-smoke'
    });
  });
  recoverySmokeOutputPath = recoveryResult?.path || '';
  if (!recoveryResult?.ok || !recoverySmokeOutputPath) {
    throw new Error(`Recovery project save failed: ${JSON.stringify(recoveryResult)}`);
  }
  const recoveryDocument = JSON.parse(await readFile(recoverySmokeOutputPath, 'utf8'));
  if (recoveryDocument.format !== 'particle-model-studio-project') {
    throw new Error(`Recovery project is invalid: ${recoverySmokeOutputPath}`);
  }
  result.recoveryProject = {
    ok: true,
    name: recoveryResult.name,
    bytes: recoveryResult.bytes
  };

  await writeFile(pathReferenceProjectSmokePath, JSON.stringify({
    format: 'particle-model-studio-project',
    schemaVersion: 1,
    appVersion: expectedVersion,
    scene: {
      sceneModels: {
        activeId: 'path-reference-model',
        models: [{
          id: 'path-reference-model',
          name: 'cs.glb',
          extension: 'glb',
          path: path.join(rootDir, 'public', 'cs.glb')
        }]
      }
    }
  }), 'utf8');
  await electronApp.evaluate(async ({ dialog }, filePath) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] });
  }, pathReferenceProjectSmokePath);
  const pathReferenceResult = await page.evaluate(() => window.electronAPI.openProject());
  const pathReferenceAsset = pathReferenceResult?.document?.scene?.sceneModels?.models?.[0];
  if (
    !pathReferenceResult?.ok ||
    !pathReferenceAsset?.url?.startsWith('/__runtime-asset/') ||
    pathReferenceAsset.path !== path.join(rootDir, 'public', 'cs.glb')
  ) {
    throw new Error(`Path-reference recovery open failed: ${JSON.stringify(pathReferenceResult)}`);
  }
  result.pathReferenceRecovery = { ok: true, materialized: true };

  await electronApp.evaluate(async ({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({
      canceled: false,
      filePath
    });
  }, automaticRecoveryFailurePath);
  const automaticRecoveryResult = await page.evaluate(async () => {
    const result = await window.particleStudio.saveProject(true);
    return {
      result,
      status: document.querySelector('#status')?.textContent || ''
    };
  });
  automaticRecoveryOutputPath = automaticRecoveryResult.result?.recovery?.path || '';
  if (
    automaticRecoveryResult.result?.ok ||
    !automaticRecoveryResult.result?.recovery?.ok ||
    !automaticRecoveryOutputPath ||
    !automaticRecoveryResult.status.includes('恢复副本已保存')
  ) {
    throw new Error(`Automatic project recovery failed: ${JSON.stringify(automaticRecoveryResult)}`);
  }
  result.automaticRecovery = {
    ok: true,
    name: automaticRecoveryResult.result.recovery.name,
    status: automaticRecoveryResult.status
  };

  const exportResult = await page.evaluate(async () => {
    const source = document.createElement('canvas');
    source.width = 64;
    source.height = 32;
    const context = source.getContext('2d');
    const gradient = context.createLinearGradient(0, 0, 64, 32);
    gradient.addColorStop(0, '#0b4fff');
    gradient.addColorStop(1, '#ffb51f');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 64, 32);
    return window.electronAPI.exportMov({
      name: `particle-electron-smoke-${Date.now()}`,
      format: 'mp4-360',
      duration: 0.25,
      fps: 4,
      width: 320,
      height: 160,
      pixelRatio: 1,
      startTime: 0,
      cameraStartTime: 0,
      effectStartTime: 0,
      options: {
        effectMode: 'image',
        imageSplatCount: 500,
        imageSplatDepth: 0.2,
        imageSplatScatter: 0,
        imageSplatSpeed: 0,
        imageSplatSize: 1.2,
        imageSplatOpacity: 1,
        imageSplatGlow: 0,
        imageSplatPlaneVisible: true,
        autoRotate: false,
        glowRadius: 0,
        glowExposure: 0
      },
      cameraKeyframes: [],
      parameterKeyframes: [],
      cameraSnapshot: {
        ...window.particleStudio.captureViewCamera(),
        cameraType: 'panorama',
        dofEnabled: false
      },
      imageSplat: {
        name: 'electron-smoke.png',
        extension: 'png',
        kind: 'image-preview',
        dataUrl: source.toDataURL('image/png'),
        params: {
          effectMode: 'image',
          imageSplatCount: 500,
          imageSplatDepth: 0.2,
          imageSplatScatter: 0,
          imageSplatSpeed: 0,
          imageSplatSize: 1.2,
          imageSplatOpacity: 1,
          imageSplatGlow: 0,
          imageSplatPlaneVisible: true
        }
      }
    });
  });
  if (!exportResult?.ok || !exportResult.path) {
    throw new Error(`Packaged 360 MP4 export failed: ${JSON.stringify(exportResult)}`);
  }
  const exportedProbe = await probeMedia(exportResult.path);
  if (!exportedProbe.includes('spherical: equirectangular') || !exportedProbe.includes('320x160')) {
    throw new Error(`Packaged 360 MP4 metadata is invalid:\n${exportedProbe}`);
  }
  result.export360 = {
    format: exportResult.format,
    width: exportResult.width,
    height: exportResult.height,
    spherical: true
  };
  await rm(exportResult.path, { force: true });
  if (errors.length) {
    throw new Error(`Renderer errors: ${errors.join(' | ')}`);
  }

  console.log(JSON.stringify({
    ok: true,
    packaged,
    executablePath,
    appVersion,
    uiLayout,
    uiScreenshotPath,
    uiCameraScreenshotPath,
    uiGraphScreenshotPath,
    result,
    errors
  }, null, 2));
} finally {
  await electronApp?.close().catch(() => {});
  await rm(projectSmokePath, { force: true }).catch(() => {});
  await rm(streamedProjectSmokePath, { force: true }).catch(() => {});
  await rm(streamedAssetSmokePath, { force: true }).catch(() => {});
  await rm(videoProjectSmokePath, { force: true }).catch(() => {});
  await rm(videoAssetSmokePath, { force: true }).catch(() => {});
  await rm(movAssetSmokePath, { force: true }).catch(() => {});
  await rm(missingProjectSmokePath, { force: true }).catch(() => {});
  await rm(pathReferenceProjectSmokePath, { force: true }).catch(() => {});
  await rm(path.dirname(automaticRecoveryFailurePath), { recursive: true, force: true }).catch(() => {});
  if (recoverySmokeOutputPath) {
    await rm(recoverySmokeOutputPath, { force: true }).catch(() => {});
  }
  if (automaticRecoveryOutputPath) {
    await rm(automaticRecoveryOutputPath, { force: true }).catch(() => {});
  }
}

async function createAlphaMovSmoke(outputPath) {
  await runFfmpeg([
    '-y',
    '-hide_banner',
    '-f',
    'lavfi',
    '-i',
    'color=c=black@0.0:s=48x48:d=0.5:r=6,format=rgba,drawbox=x=8:y=8:w=32:h=32:color=red@0.65:t=fill',
    '-c:v',
    'qtrle',
    '-pix_fmt',
    'argb',
    outputPath
  ]);
}

async function runFfmpeg(args) {
  const child = spawn(ffmpegPath, args, {
    cwd: rootDir,
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });
  const [code] = await once(child, 'exit');
  if (code !== 0) {
    throw new Error(`FFmpeg exited with code ${code}:\n${stderr}`);
  }
  return stderr;
}

async function probeMedia(filePath) {
  const child = spawn(ffmpegPath, ['-hide_banner', '-i', filePath], {
    cwd: rootDir,
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString();
  });
  await once(child, 'exit');
  return stderr;
}
