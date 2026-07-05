const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  exportMov: (payload) => ipcRenderer.invoke('export-mov', payload),
  saveProject: (payload) => ipcRenderer.invoke('save-project', payload),
  openProject: () => ipcRenderer.invoke('open-project'),
  convertBlendToGlb: (payload) => ipcRenderer.invoke('convert-blend-to-glb', payload),
  checkLocalSharp: () => ipcRenderer.invoke('check-local-sharp'),
  installLocalSharp: (payload) => ipcRenderer.invoke('install-local-sharp', payload),
  runLocalSharp: (payload) => ipcRenderer.invoke('run-local-sharp', payload),
  showItemInFolder: (filePath) => ipcRenderer.invoke('show-item-in-folder', filePath),
  getPathForFile: (file) => {
    try {
      return webUtils?.getPathForFile?.(file) || file?.path || '';
    } catch {
      return file?.path || '';
    }
  },
  isDesktop: true
});
