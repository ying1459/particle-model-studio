# Particle Model Studio / 模型粒子化

[![Release](https://img.shields.io/github/v/release/ying1459/particle-model-studio)](https://github.com/ying1459/particle-model-studio/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20x64-0078D6)](https://github.com/ying1459/particle-model-studio/releases/latest)

一个面向视觉创作者的实时 3D 粒子编辑器。导入模型或图片，制作模型表面粒子、消散、粒子变形、图片点云、Gaussian Splat、灯光、HDR、相机和关键帧动画，并导出透明 MOV。

Particle Model Studio is a real-time 3D particle editor for visual creators. Import models or images, build particle dissolves and morphs, preview Gaussian Splats, animate cameras and parameters, and export transparent MOV files.

## 功能 / Features

- GLB、GLTF、FBX、OBJ、STL 模型导入
- 模型表面粒子化、完整粒子消散、模型转粒子和双模型粒子变形
- 图片点云与可选的高质量 SHARP Gaussian 重建
- PLY / SPLAT / KSPLAT Gaussian Splat 预览
- HDR、灯光、模型材质和场景编辑
- 模型动画、参数关键帧、相机关键帧和手势控制
- 透明背景 MOV 导出
- Windows x64 桌面版，可离线运行

## 下载 / Download

前往 [Releases](https://github.com/ying1459/particle-model-studio/releases/latest)：

- **Lite**：单个压缩包。包含完整编辑器和内置图片点云效果，适合大多数用户。
- **Full SHARP**：包含 Apple ml-sharp、Python 运行环境和模型权重。由于体积较大，以多个 RAR 分卷发布；下载全部分卷到同一文件夹，从 `part1.rar` 开始解压。

解压后运行 `Particle Model Studio.exe`。不要只复制 exe，必须保留整个解压目录。

## 本地开发 / Development

```bash
npm install
npm run dev
```

构建桌面应用：

```bash
npm run dist:win
```

可选 SHARP 环境可通过 `electron/setup-ml-sharp.ps1` 安装。大型 Python 运行时和模型权重不会提交到 Git 仓库。

## 许可 / License

本项目自有源代码采用 [MIT License](LICENSE)。第三方组件遵循各自许可，详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

特别注意：Full SHARP 包中的 Apple Machine Learning Research Model **仅限非商业科研和学术开发用途**，不适用于商业利用、产品开发或商业产品/服务。Lite 包不包含该模型。

## Support

如果这个项目对你有帮助，欢迎点一个 Star。问题和建议请提交到 [Issues](https://github.com/ying1459/particle-model-studio/issues)。
