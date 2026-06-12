const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("jarvis", {
  send: (input) => ipcRenderer.invoke("jarvis:send", input),
  show: () => ipcRenderer.invoke("jarvis:show"),
  transcribe: (audio, mimeType, durationMs) =>
    ipcRenderer.invoke("jarvis:transcribe", { audio, mimeType, durationMs }),
  onFocusInput: (callback) => {
    ipcRenderer.on("jarvis:focus-input", callback);
  },
  onPushToTalkStart: (callback) => {
    ipcRenderer.on("jarvis:ptt-start", callback);
  },
  onPushToTalkStop: (callback) => {
    ipcRenderer.on("jarvis:ptt-stop", callback);
  },
  speak: (text) => ipcRenderer.invoke("jarvis:speak", text),
  onProactiveMessage: (callback) => {
    ipcRenderer.on("jarvis:proactive-message", (_event, message) => callback(message));
  }
});
