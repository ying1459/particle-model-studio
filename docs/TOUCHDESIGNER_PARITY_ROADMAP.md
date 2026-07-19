# Particle Model Studio：TouchDesigner 覆盖与超越路线

## 产品北极星

让创作者在不搭复杂 patch 的情况下完成实时视觉，同时为高级用户保留可编程、可组合、可扩展的底层能力。

产品采用双层工作流：

- **创作模式**：当前的参数化面板、模板、时间轴和一键导出。用于快速出片。
- **图谱模式**：可视化算子图、类型化端口、实时数据流和自定义算子。用于替代 TouchDesigner 的开放式工作流。

两种模式共享同一个工程和运行时。创作模式中的每个高级效果都应能“展开为图谱”，图谱也能封装成一个带友好参数面板的模板。

## 能力覆盖地图

| 领域 | TouchDesigner 对应能力 | Particle Model Studio 目标 |
| --- | --- | --- |
| 图像 / 视频 | TOP | GPU 图像算子、反馈、合成、色彩管理、视频解码与编码 |
| 几何 / 粒子 | SOP、Particle SOP | 网格、点云、粒子、SDF、实例化、GPU 模拟 |
| 信号 / 音频 | CHOP | 音频分析、曲线、滤波、触发器、MIDI、时间序列 |
| 数据 | DAT | 表格、JSON、CSV、文本、HTTP/WebSocket、本地数据处理 |
| 场景 / UI | COMP、Panel | 3D 场景、相机、灯光、交互面板、可复用组件 |
| 材质 / Shader | MAT、GLSL | PBR、节点材质、自定义 GLSL/WGSL、热重载与错误定位 |
| 外部设备 | OSC、MIDI、DMX、NDI、Spout | OSC/MIDI/DMX、摄像头、深度相机、NDI、Spout、WebRTC |
| 演出与输出 | Perform Mode、映射 | 全屏演出、投影映射、多屏、录制、输出监控和故障恢复 |
| 自动化 | Python、Expressions | JavaScript/Python 脚本、表达式、参数绑定、事件和插件 SDK |

## 分阶段落地

### P0：视觉可信度与所见即所得

- 统一主视口、相机预览、静帧和视频导出的后期链。
- 建立 Glow、DOF、消散、粒子密度的固定视觉回归场景。
- 提供 Low / Medium / High / Auto 质量档位和 GPU 性能面板。
- 完成大工程、长视频、多模型、多相机的压力测试。

验收：同一工程在视口、相机预览与导出中的构图和视觉效果一致；低端设备能自动降级而不是卡死。

### P1：算子图内核

- 定义带版本号的图谱 schema、节点、类型化输入输出端口和参数引用。
- 实现拓扑调度、脏标记增量计算、反馈节点、缓存和撤销/重做。
- 首批节点覆盖 Render、Particle、Transform、Noise、Blur、Composite、Audio Analyze、OSC Input、Video Out。
- 任意节点可封装成 Macro；Macro 自动生成创作模式属性面板。

验收：无需修改核心代码即可用图谱复现当前内置粒子消散效果。

### P2：实时输入输出与演出

- MIDI、OSC、音频输入、摄像头、MediaPipe、WebSocket。
- Spout / NDI、DMX / Art-Net、多窗口、多显示器和投影映射。
- 演出模式、参数快照、Cue 列表、远程控制台、掉线重连和看门狗。

验收：可独立完成一场包含实时音频驱动、摄像头交互和多屏输出的演出。

### P3：开放式创作平台

- 节点材质、GLSL/WGSL 编辑器、GPU Compute 和 SDF 工具链。
- JavaScript/Python 插件 SDK、沙盒权限、依赖声明和本地插件市场。
- 工程依赖锁定、可复现打包、无头渲染和命令行批处理。
- 可选协作：版本对比、参数审阅、资产去重与远程渲染队列。

验收：第三方能在不 fork 主仓库的情况下发布节点、设备适配器和效果包。

## 明确超越 TouchDesigner 的方向

- **意图式创作**：自然语言生成可编辑图谱，但所有结果必须可见、可撤销、可复现。
- **渐进式复杂度**：先用模板完成作品，需要时再展开底层节点，不强迫新用户先学 patch。
- **视觉诊断**：自动标出卡顿节点、显存热点、色彩空间错误、断开的素材和输出不一致。
- **工程可靠性**：自动恢复、依赖锁定、素材重连、版本迁移和确定性导出作为核心能力。
- **跨模态资产**：模型、Gaussian Splat、图片、视频、音频、深度数据和生成式资产使用统一时间线与节点系统。
- **可交付模板**：创作者能把复杂图谱发布为带说明、缩略图、默认质量档和安全范围的“一键效果”。

## 架构约束

- 不在现有 `src/main.js` 中继续无限堆叠节点系统；先抽出无副作用的渲染、工程 schema 和调度模块。
- 视口和导出必须调用同一渲染图，质量差异只能来自明确的质量档位。
- 新工程字段必须向后兼容；运行时能力、插件权限和外部 I/O 必须可检测、可降级。
- AI 功能不能生成不可理解的黑盒工程；生成结果必须落为普通节点、参数和资产引用。

## 当前里程碑

P0 的视觉可信度能力已经落地：多尺度辉光、主视口薄透镜景深、流场消散、近远景屏幕空间粒子密度锁定、固定视觉回归场景，以及 Auto / Low / Medium / High 质量档。密度锁定会把近景覆盖范围确定性地细分为固定像素尺度的微粒，保留小粒子质感并避免稀疏采样空隙；质量档会联合控制 DPR、Bloom 分辨率与层数、DOF 采样（12 / 24 / 48）、相机预览分辨率/频率和动画粒子刷新率，但不会改写作品参数。

P1 的前十二批底层、入口、运行时、GPU 资源链、基础图编辑、点云资源化、拓扑驱动的 RenderTarget 生存期、有状态粒子 Feedback、可组合力场、局部空间碰撞、GPU 历史拖尾和确定性出生/寿命已经落地：

- 独立的 `src/core/operator-graph.js` 提供版本 1 schema、内置算子注册表、类型化端口、结构化诊断、同帧环检测、显式反馈边、稳定拓扑分层和脏节点下游传播。
- 当前创作模式自动映射为 13 个节点 / 14 条连线：Model → Particles → Flow Dissolve → Force Field → Return / Repel → Emitter → Birth / Life → Particle Feedback → Particle Render → Deep Glow → Depth of Field → Viewport，Camera 同时连接 Render 与 DOF。
- `.pms` 工程新增可选 `operatorGraph` 字段；旧工程没有该字段时会从恢复后的创作参数自动生成，schema 版本仍保持 1，避免破坏现有工程。
- 独立的 `src/core/operator-runtime.js` 已实现执行器注册、拓扑/参数签名、节点输出缓存、脏标记下游失效、实时节点、上一帧反馈、逐节点耗时、缓存命中和结构化错误。
- 主视口、相机预览、静帧及视频导出现在都先执行同一张算子图，再由 `viewport-output` 触发共享 GPU 合成；运行失败会记录错误并安全回退到旧渲染入口。
- 首批 Model / Particle / Dissolve / Camera / Render / Glow / DOF / Viewport 执行器已经注册；Glow 和 DOF 节点旁路会真实改变视口与导出结果。
- `src/core/operator-resources.js` 定义了带版本、作用域、帧号、生产节点、生命周期、尺寸/点数、字节数、格式和色彩空间的资源契约；诊断只暴露可序列化元数据，不泄露 WebGL handle、Three.js object 或运行时 payload。
- `src/core/operator-resource-pool.js` 提供与 Three.js 解耦的通用资源池内核：资源按稳定 descriptor key 复用，支持 adopted / owned 两类条目、并发溢出分配、retain 引用计数、逐帧租借/释放、泄漏检测和可序列化诊断。真实后期链把现有 9 个 HDR / Depth RenderTarget 作为容量直接纳入池管理，不额外复制纹理，但不再在帧开始全部租满。
- `src/core/operator-resource-lifetime.js` 新增拓扑资源生存期内核；运行时按 demanded 同帧边计算每个输出的消费者数量，节点执行时先发布输出再消费输入，保证旁路/别名纹理不会提前释放。最后消费者执行后立即归还目标；零消费者输出会立刻释放，已释放的帧资源会自动使 Runtime 缓存失效。
- 主视口、相机预览、相机视图与导出都通过同一套节点级租借入口：完整 Glow+DOF 链为 11 次命中但并发峰值 7，Glow-only 为 7，DOF-only 为 5 / 峰值 5，Render 直连 Viewport 仅为 1，断线或禁用输出为 0；所有路径均为 0 新分配、0 活跃租借。DOF 会在 Glow 归还后复用两张 blur ping-pong 目标做焦外源预滤波，因此增加 pass 而不增加资源池容量；尺寸变化时围绕 resize 后的既有目标重建索引，只销毁池自己创建的溢出资源。
- Perspective 渲染已拆成真实的四段 GPU 资源链：Particle Render 输出 RGBA16F 颜色与 Depth32，Glow 输出独立 HDR 纹理，DOF 输出独立 HDR 纹理，Viewport 最后执行 AgX 色调映射。旁路会跳过相应 GPU pass，而不是只修改终端布尔值。
- 运行时支持以 `viewport-output` 为需求根的按需 Cook；自定义图把 Render 直接连到 Viewport 时，未连接的 Glow / DOF 分支不会执行。
- Graph 模式中的 Glow 半径/曝光、层数和 DOF 参数已经成为对应 GPU pass 的权威值；Creator 相机面板也暴露散景半径、高光、光圈叶片与圆润度，并可 K 帧和随 `.pms` 往返；不改 Creator 状态仍能在 Graph 中独立改变图谱输出。
- Particle Sampler 与 Flow Dissolve 现在生产真实 `points` resource，记录当前点数、属性字节数、来源和消散参数；Particle Render 强制消费上游 points，颜色/深度资源记录其来源。Render 与 Glow pass 会按资源临时绑定粒子 shader 参数并在 pass 后恢复，因此 Graph 消散不会污染 Creator 全局状态，分支可拥有不同参数。
- Flow Dissolve 旁路会把 Sampler points 原样传给 Render；自定义消散参数可随 `.pms` 保存、重开并继续执行。Sampler 现阶段每帧重新发布当前 geometry，避免动画或重采样后消费已释放的旧缓冲。
- `src/core/gpu-particle-feedback.js` 使用两组浮点 RGBA 状态纹理和双缓冲 RenderTarget 在 GPU 上保存模型局部绝对位置/年龄与速度/seed，并用独立 base-position 纹理跟踪原始采样点；Particle Feedback 支持跨帧力场、curl/turbulence、吸引、阻力、阻尼、速度上限、子步、最多 4 个 Attractor 和 4 个平面碰撞体。Emitter 与 Birth/Life 以稳定 seed 和绝对时间解析 All / Continuous / Burst 的 active、age、lifetime 与周期，时间 seek 可直接恢复正确生命周期阶段。
- Particle Trail 使用最多 8 张 RGBA32F 位置纹理组成按需分配的 GPU 环形历史，在 simulation substep 前按确定性间隔抓取绝对 Feedback 位置，并按新到旧顺序输出；Particle Render 与 Deep Glow 都会用独立 draw 重绘历史，可控制样本数、间隔、透明度、时间衰减和尺寸。Low / Medium / High 分别把上限约束为 2 / 4 / 8，不加入 Trail 的默认工程不分配历史显存。
- Feedback 状态按 renderer / scope / node 隔离，支持通用旁路、显式 Reset Pulse、时间跳转重置、质量档子步上限和硬件能力降级；Creator 提供强度、湍流、阻力三个高频入口，Graph 暴露完整参数。
- `src/core/particle-simulation-modifiers.js` 定义版本化的 force-field / return-force / emitter / birth-life / attractor / collision-plane / trail 契约；多个 Force 节点可按 strength 叠加方向力、turbulence 与 curl，Return 正值吸引源形、负值排斥，最后一个启用的 Emitter、Birth/Life 与 Trail 分别决定发射、生命周期和历史配置，Attractor 与 Plane Collision 提供局部空间力和碰撞。七类节点均发布真实 points resource，Feedback 在 GPU step 前合并 modifier 与旧版内置参数，并报告最终有效值和贡献节点。
- 顶部“图谱”工作区已可显示真实端口和连线、拖动节点、查看参数与资源、验证图谱、预演任意节点的增量执行范围，并显示最近一次节点耗时、缓存与 GPU pass 状态。
- 新增不可变图编辑内核和 80 步会话历史：节点库可创建、复制、移动和删除节点；检查器可编辑节点参数并通用旁路；端口可拖拽或点击连线，单输入会自动重接，连线可选择、双击或在检查器中断开；类型错误与同帧环会在提交前拒绝。
- 图编辑支持 `Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y`、Delete、Escape；最终输出节点受保护，输出断线时会给出明确错误，不再悄悄回退旧渲染路径。
- `window.particleStudio` 已公开读取、设置、重置、验证图谱、获取执行计划和 `getOperatorRuntimeStats()` 的 API；Node、浏览器和 Electron 回归均已覆盖。
- `npm run test:graph` 当前覆盖 51 项图谱、镜头数学、simulation modifier、绝对时间生命周期、Trail 环形索引、GPU Feedback、绝对 base-position、不可变编辑、历史、运行时、按需 Cook、资源契约、资源池和拓扑生存期测试；浏览器视觉回归验证 Glow/Flow/Force/Feedback/Emitter/Birth-Life/Attractor/Plane Collision/Trail/DOF、All/Burst/Continuous 画面差异、同时间重复渲染、薄透镜散景、跨帧累计模拟、完整 Glow+DOF、Render 直连、异常/禁用输出以及 resize 租借；Electron 回归验证景深高级参数、七类 modifier 与 `.pms` 往返、节点编辑/旁路、Feedback Reset、历史显存、生命周期诊断、`Pool / Live` 诊断、真实导出帧按效果租借和零控制台错误。

- DOF 已从通用屏幕模糊升级为有符号薄透镜模型：焦点平面 CoC 为零，前景与背景使用相反符号；焦外源先在复用的低分辨率目标中做预滤波，再以固定方向的圆润 3–12 叶光圈聚合，最后在全分辨率按 CoC 合成焦内原图。孤立亮点回归会分别输出锐利参考和 f/1.2 散景样张，避免只验证“画面有变化”。

当前边界必须说清：points、颜色、深度、Glow、DOF、七类 simulation modifier 和 Particle Feedback 已是可诊断、可旁路、可改线的真实节点资源；RenderTarget 已完成按需求节点租借和按最后消费者释放，粒子也已有跨帧可写 GPU 状态与最多 8 帧的 Feedback 位置历史。DOF 是屏幕空间薄透镜近似，不是光线追踪镜头；尚无猫眼口径遮挡、轴向色差、污渍纹理、散景旋转动画或精确的前景遮挡 matte。Trail 只保存模型局部 Feedback 绝对位置，并以额外 core / glow draw 重绘，不是完整解析消散、材质、任意 attribute 或整个场景的运动历史。Emitter/Birth-Life 已保证相同时间的 active、age、lifetime 与 spawn 周期可复现，但 seek 时不会恢复此前力场积分的位置/速度/碰撞/Trail 历史，所以 `motionSeekDeterministic=false`；完整运动状态快照和固定时间步重放仍未实现。modifier 的实际状态写入仍集中在 Feedback compute，也不是任意节点独立读写任意 attribute 的通用 storage-buffer 图；Attractor 与 Plane Collision 当前采用模型局部坐标和离散平面投影，还不是世界空间变换、连续碰撞、球体/SDF 碰撞。任意 attribute、分支合流规则和状态快照仍未实现，Sampler 也暂以每帧发布保证 geometry 正确。编辑器还缺框选/多选、复制粘贴、搜索放置、Macro/子图、参数 schema 与图内关键帧。因此 P1 仍未验收完成。下一批优先建立固定时间步、GPU 状态快照/恢复和 seek/export 重放契约，再扩展通用 attribute/state 与分支合流。
