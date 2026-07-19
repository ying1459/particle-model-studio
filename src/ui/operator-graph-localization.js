const NODE_LABELS = Object.freeze({
  'core.feedback': '反馈回路',
  'asset.model-input': '模型输入',
  'geometry.particle-sampler': '粒子采样',
  'simulation.dissolve': '流动消散',
  'simulation.force-field': '力场',
  'simulation.return-force': '回归 / 排斥',
  'simulation.emitter': '粒子发射器',
  'simulation.birth-life': '出生 / 生命周期',
  'simulation.attractor': '吸引器',
  'simulation.collision-plane': '平面碰撞',
  'simulation.trail': '粒子拖尾',
  'simulation.feedback-particles': '粒子反馈',
  'scene.camera': '相机',
  'render.particles': '粒子渲染',
  'post.glow': '多层深度辉光',
  'post.depth-of-field': '光圈景深',
  'output.viewport': '视口输出'
});

const CATEGORY_LABELS = Object.freeze({
  Core: '核心',
  Asset: '素材',
  Geometry: '几何',
  Simulation: '模拟',
  Scene: '场景',
  Render: '渲染',
  Post: '后期',
  Output: '输出'
});

const PORT_LABELS = Object.freeze({
  input: '输入',
  output: '输出',
  geometry: '几何体',
  points: '粒子点',
  texture: '图像',
  color: '颜色',
  depth: '深度',
  camera: '相机',
  scene: '场景',
  material: '材质',
  signal: '信号',
  data: '数据',
  event: '事件'
});

const PORT_TYPE_LABELS = Object.freeze({
  any: '任意',
  geometry: '几何体',
  points: '粒子点',
  texture: '图像纹理',
  depth: '深度',
  camera: '相机',
  scene: '场景',
  material: '材质',
  signal: '数值信号',
  data: '数据',
  event: '事件'
});

const PARAM_LABELS = Object.freeze({
  aperture: '光圈值',
  attraction: '吸引力',
  blades: '光圈叶片数',
  bokehScale: '散景尺寸',
  burstCount: '爆发数量',
  centerX: '中心 X',
  centerY: '中心 Y',
  centerZ: '中心 Z',
  curl: '卷曲强度',
  damping: '阻尼',
  directionX: '方向 X',
  directionY: '方向 Y',
  directionZ: '方向 Z',
  dissolve: '消散进度',
  dissolveCoupling: '消散耦合',
  dissolveCurl: '消散卷曲',
  dissolveDirectionX: '消散方向 X',
  dissolveDirectionY: '消散方向 Y',
  dissolveDirectionZ: '消散方向 Z',
  dissolveEdgeWidth: '消散边缘宽度',
  dissolveLift: '消散上扬 / 下坠',
  dissolveMist: '雾化碎散',
  dissolveSpread: '消散扩散距离',
  dissolveTurbulence: '消散湍流',
  dofEnabled: '启用景深',
  drag: '空气阻力',
  duration: '持续时间',
  edgeBreak: '边缘撕裂',
  edgeFeather: '边缘羽化',
  emissionEnabled: '启用自发光',
  emissionIntensity: '自发光强度',
  enabled: '启用',
  fade: '拖尾衰减',
  fadeIn: '淡入时间',
  fadeOut: '淡出时间',
  falloff: '衰减指数',
  filamentCurl: '流丝卷曲',
  filamentLength: '流丝长度',
  flowCharacter: '质感（丝滑 — 细碎）',
  flowDirectionPreset: '流动方向',
  flowStyle: '粒子流风格',
  focalLength: '焦距',
  focusDistance: '对焦距离',
  forceX: '作用力 X',
  forceY: '作用力 Y',
  forceZ: '作用力 Z',
  fov: '视野角度',
  friction: '摩擦力',
  glowExposure: '辉光曝光',
  glowRadius: '辉光半径',
  growth: '生长进度',
  growthFlow: '生长流动感',
  growthTurbulence: '生长湍流',
  growthWidth: '生长宽度',
  highlightGain: '高光增益',
  interval: '采样间隔',
  layers: '辉光层数',
  life: '反馈寿命',
  lifetimeMax: '最长寿命',
  lifetimeMin: '最短寿命',
  loaded: '模型已加载',
  loop: '循环发射',
  loopInterval: '循环间隔',
  maxVelocity: '最大速度',
  mode: '发射模式',
  modelVisibility: '模型显隐',
  name: '模型名称',
  noise: '噪波强度',
  noiseScale: '噪波大小',
  normalX: '平面法线 X',
  normalY: '平面法线 Y',
  normalZ: '平面法线 Z',
  offset: '平面偏移',
  opacity: '透明度',
  organicFlow: '花瓣流体',
  particleColor: '粒子颜色',
  particleCount: '粒子数量',
  particleizeProgress: '粒子化进度',
  pointSize: '粒子尺寸',
  positionSpread: '出生位置扩散',
  qualityLevel: '质量等级',
  qualityMode: '质量模式',
  radius: '作用半径',
  rate: '每秒发射数量',
  renderScale: '渲染比例',
  resetVersion: '状态重置版本',
  respawn: '寿命结束后重生',
  restitution: '碰撞弹性',
  roundness: '光圈圆度',
  sampleCleanup: '采样清理',
  samples: '采样数量',
  seed: '随机种子',
  sensorWidth: '传感器宽度',
  size: '拖尾尺寸',
  sizeRandom: '尺寸随机',
  speed: '速度',
  spread: '扩散强度',
  startTime: '开始时间',
  strength: '强度',
  substeps: '模拟子步数',
  surfaceBias: '表面偏移',
  swirl: '涡旋强度',
  timeScale: '时间缩放',
  turbulence: '湍流强度',
  type: '相机类型'
});

const PARAM_OPTIONS = Object.freeze({
  'simulation.dissolve:flowStyle': Object.freeze([
    Object.freeze({ value: 'fluid-ribbon', label: '流体丝带' }),
    Object.freeze({ value: 'weathered-dust', label: '风化烟尘' }),
    Object.freeze({ value: 'energy-burst', label: '能量爆散' })
  ]),
  'simulation.dissolve:flowDirectionPreset': Object.freeze([
    Object.freeze({ value: 'auto', label: '自动' }),
    Object.freeze({ value: 'left', label: '向左' }),
    Object.freeze({ value: 'right', label: '向右' }),
    Object.freeze({ value: 'up', label: '向上' }),
    Object.freeze({ value: 'down', label: '向下' }),
    Object.freeze({ value: 'forward', label: '向前' }),
    Object.freeze({ value: 'backward', label: '向后' }),
    Object.freeze({ value: 'custom', label: '自定义' })
  ]),
  'simulation.emitter:mode': Object.freeze([
    Object.freeze({ value: 'all', label: '全部粒子立即存在' }),
    Object.freeze({ value: 'continuous', label: '连续发射' }),
    Object.freeze({ value: 'burst', label: '爆发发射' })
  ]),
  'scene.camera:type': Object.freeze([
    Object.freeze({ value: 'perspective', label: '透视相机' }),
    Object.freeze({ value: 'panorama', label: '360° 全景相机' })
  ]),
  'render.particles:qualityMode': Object.freeze([
    Object.freeze({ value: 'auto', label: '自动' }),
    Object.freeze({ value: 'low', label: '低质量' }),
    Object.freeze({ value: 'medium', label: '中等质量' }),
    Object.freeze({ value: 'high', label: '高质量' })
  ])
});

export function operatorNodeLabel(type, fallback = '') {
  return NODE_LABELS[type] || fallback || type || '未知节点';
}

export function operatorCategoryLabel(category) {
  return CATEGORY_LABELS[category] || category || '其他';
}

export function operatorPortLabel(portId) {
  return PORT_LABELS[portId] || portId || '未命名端口';
}

export function operatorPortTypeLabel(type) {
  return PORT_TYPE_LABELS[type] || type || '未知类型';
}

export function operatorParamLabel(key) {
  return PARAM_LABELS[key] || key || '未命名参数';
}

export function operatorParamOptions(nodeType, key) {
  return PARAM_OPTIONS[`${nodeType}:${key}`] || null;
}
