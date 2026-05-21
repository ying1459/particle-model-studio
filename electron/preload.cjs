const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  exportMov: (payload) => ipcRenderer.invoke('export-mov', payload),
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
