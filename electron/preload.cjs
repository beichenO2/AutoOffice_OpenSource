/**
 * Preload for the AutoOffice desktop window. The /aoide/ UI talks to the local
 * server over same-origin HTTP, so no privileged Node bridge is exposed here —
 * contextIsolation stays on and the renderer keeps its normal web sandbox. A
 * small marker lets the web app detect it is running inside the desktop shell.
 */
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('autooffice', {
  desktop: true,
  platform: process.platform,
});
