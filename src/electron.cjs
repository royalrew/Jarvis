const {
  app,
  BrowserWindow,
  ipcMain,
  globalShortcut,
  Menu,
  nativeImage,
  screen,
  session,
  Tray
} = require("electron");
const dotenv = require("dotenv");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

let mainWindow = null;
let triggerWindow = null;
let tray = null;
let corePromise = null;
let mouseHookProcess = null;
let isQuitting = false;
let isPushToTalkDown = false;
let pendingScreenshotBase64 = null;
let pttStopTimeout = null;
let lastInteractionTime = Date.now();
let pendingProactiveMessage = null;
const windowHistory = [];
const registeredShortcuts = [];

function loadEnv() {
  const exeDir = path.dirname(process.execPath);
  const candidates = [
    path.join(process.cwd(), ".env"),
    path.join(exeDir, ".env"),
    path.resolve(exeDir, "..", "..", ".env"),
    path.join(app.getPath("userData"), ".env")
  ];

  for (const envPath of candidates) {
    if (fs.existsSync(envPath)) {
      dotenv.config({ path: envPath, override: false });
    }
  }
}

async function loadCore() {
  if (!corePromise) {
    corePromise = (async () => {
      process.env.JARVIS_DB_PATH ||= path.join(app.getPath("userData"), "db.sqlite");
      process.env.JARVIS_NOTES_PATH ||= path.join(app.getPath("userData"), "notes");
      const db = await import("./db.js");
      db.initDb();
      return import("./core.js");
    })();
  }

  return corePromise;
}

async function createWindow() {
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === "media");
  });

  mainWindow = new BrowserWindow({
    width: 980,
    height: 720,
    minWidth: 720,
    minHeight: 520,
    title: "Jarvis",
    backgroundColor: "#101317",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  await mainWindow.loadFile(path.join(__dirname, "renderer.html"));
}

async function createTriggerWindow() {
  triggerWindow = new BrowserWindow({
    width: 62,
    height: 62,
    frame: false,
    resizable: false,
    movable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    title: "Jarvis trigger",
    backgroundColor: "#00000000",
    transparent: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  triggerWindow.setAlwaysOnTop(true, "floating");
  triggerWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  positionTriggerWindow();
  await triggerWindow.loadFile(path.join(__dirname, "trigger.html"));
}

function positionTriggerWindow() {
  if (!triggerWindow) {
    return;
  }

  const { workArea } = screen.getPrimaryDisplay();
  const size = triggerWindow.getBounds();
  triggerWindow.setPosition(
    workArea.x + workArea.width - size.width - 18,
    workArea.y + workArea.height - size.height - 18
  );
}

function createTray() {
  const icon = nativeImage.createFromDataURL(
    "data:image/svg+xml;utf8," +
      encodeURIComponent(`
        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
          <rect width="32" height="32" rx="7" fill="#101317"/>
          <path d="M8 21.5c2.1 2.1 5 3.2 8 3.2s5.9-1.1 8-3.2" fill="none" stroke="#8bd0c3" stroke-width="2.4" stroke-linecap="round"/>
          <path d="M9 10.8c2-2.2 4.3-3.4 7-3.4s5 1.2 7 3.4" fill="none" stroke="#d6965e" stroke-width="2.4" stroke-linecap="round"/>
          <circle cx="12" cy="15.6" r="1.7" fill="#eef2f0"/>
          <circle cx="20" cy="15.6" r="1.7" fill="#eef2f0"/>
        </svg>
      `)
  );

  tray = new Tray(icon);
  tray.setToolTip("Jarvis - klicka J-knappen");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Visa Jarvis", click: showAndFocusWindow },
      { label: "Gom Jarvis", click: () => mainWindow?.hide() },
      { type: "separator" },
      {
        label: "Avsluta",
        click: () => {
          isQuitting = true;
          app.quit();
        }
      }
    ])
  );
  tray.on("click", showAndFocusWindow);
}

function registerShortcuts() {
  for (const accelerator of ["CommandOrControl+Alt+J", "F8"]) {
    const didRegister = globalShortcut.register(accelerator, showAndFocusWindow);
    if (didRegister) {
      registeredShortcuts.push(accelerator);
    }
  }
}

function startMouseHook() {
  if (process.platform !== "win32") {
    return;
  }

  const scriptPath = path.join(app.getPath("temp"), "jarvis-mouse-hook.ps1");
  fs.writeFileSync(scriptPath, getMouseHookScript(), "utf8");

  mouseHookProcess = spawn(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath],
    {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    }
  );

  let buffer = "";
  mouseHookProcess.stdout.setEncoding("utf8");
  mouseHookProcess.stdout.on("data", (chunk) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";

    for (const line of lines) {
      handleMouseHookEvent(line.trim());
    }
  });

  mouseHookProcess.stderr.setEncoding("utf8");
  mouseHookProcess.stderr.on("data", (chunk) => {
    console.error(`[Jarvis mouse hook] ${chunk}`);
  });

  mouseHookProcess.on("exit", () => {
    mouseHookProcess = null;
  });
}

function handleMouseHookEvent(eventName) {
  if (eventName.startsWith("WINDOW:")) {
    const parts = eventName.slice(7).split("|");
    const proc = parts[0];
    const title = parts.slice(1).join("|");
    if (proc && proc.toLowerCase() !== "jarvis") {
      windowHistory.unshift({ proc, title, time: Date.now() });
      if (windowHistory.length > 8) windowHistory.pop();
    }
    return;
  }

  if (eventName === "MIDDLE_DOWN") {
    clearTimeout(pttStopTimeout);
    pttStopTimeout = null;

    if (!isPushToTalkDown) {
      isPushToTalkDown = true;
      captureAndStoreScreenshot();
      showAndFocusWindow();
      mainWindow?.webContents.send("jarvis:ptt-start");
    }
  }

  if (eventName === "MIDDLE_UP" && isPushToTalkDown) {
    pttStopTimeout = setTimeout(() => {
      isPushToTalkDown = false;
      mainWindow?.webContents.send("jarvis:ptt-stop");
    }, 150);
  }
}

function buildWindowContext() {
  if (windowHistory.length === 0) return null;
  const now = Date.now();
  return windowHistory.slice(0, 5).map((w, i) => {
    const mins = Math.round((now - w.time) / 60000);
    const age = mins < 1 ? "" : ` (${mins} min sedan)`;
    const label = w.title ? `${w.proc}: ${w.title}` : w.proc;
    return i === 0 ? label : label + age;
  }).join(" → ");
}

async function captureAndStoreScreenshot() {
  try {
    const { desktopCapturer } = require("electron");
    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: { width: 1280, height: 800 }
    });
    if (sources.length > 0) {
      pendingScreenshotBase64 = sources[0].thumbnail.toPNG().toString("base64");
    }
  } catch (error) {
    console.error("[Jarvis screenshot]", error);
  }
}

function showAndFocusWindow() {
  if (!mainWindow) {
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  mainWindow.show();
  mainWindow.focus();
  mainWindow.webContents.send("jarvis:focus-input");
}

function showProactiveNotification(message) {
  const { Notification } = require("electron");
  if (!Notification.isSupported()) return;

  const n = new Notification({ title: "Jarvis", body: message, silent: false });
  n.on("click", () => {
    pendingProactiveMessage = message;
    showAndFocusWindow();
    setTimeout(() => {
      mainWindow?.webContents.send("jarvis:proactive-message", message);
      pendingProactiveMessage = null;
    }, 400);
  });
  n.show();
}

async function runProactiveCheck() {
  try {
    const minutesSince = Math.round((Date.now() - lastInteractionTime) / 60000);
    const proactive = await import("./proactive.js");
    const message = await proactive.checkForProactiveInsight({
      minutesSinceLastInteraction: minutesSince,
      windowHistory: windowHistory.slice(0, 5)
    });
    if (message) {
      console.log("[Jarvis proaktiv]", message);
      showProactiveNotification(message);
    }
  } catch (err) {
    console.error("[Jarvis proaktiv]", err);
  }
}

function startProactiveLoop() {
  const intervalMin = parseInt(process.env.JARVIS_PROACTIVE_INTERVAL_MIN || "30", 10);
  if (isNaN(intervalMin) || intervalMin <= 0) return;
  setInterval(runProactiveCheck, intervalMin * 60000);
}

app.whenReady().then(async () => {
  loadEnv();
  await loadCore();
  await createWindow();
  await createTriggerWindow();
  createTray();
  registerShortcuts();
  startMouseHook();
  screen.on("display-metrics-changed", positionTriggerWindow);
  startProactiveLoop();

  // Starta Telegram-bot i bakgrunden
  import("./telegram.js").then((telegram) => {
    telegram.startTelegramBot();
  }).catch((err) => {
    console.error("[Jarvis Electron] Kunde inte starta Telegram-bot:", err);
  });

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    }
  });
});

app.on("before-quit", () => {
  isQuitting = true;
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin" && isQuitting) {
    app.quit();
  }
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  if (mouseHookProcess) {
    mouseHookProcess.kill();
    mouseHookProcess = null;
  }
});

ipcMain.handle("jarvis:show", () => {
  showAndFocusWindow();
});

ipcMain.handle("jarvis:speak", async (_event, text) => {
  try {
    const llm = await import("./llm.js");
    const buffer = await llm.generateTTSBuffer(text);
    if (!buffer) return null;
    return buffer.toString("base64");
  } catch (err) {
    console.error("[Jarvis TTS IPC] fel:", err);
    return null;
  }
});

ipcMain.handle("jarvis:transcribe", async (_event, payload) => {
  const transcription = await import("./transcription.js");
  const result = await transcription.transcribeAudio(payload);
  console.log("[Jarvis IPC] transkribering klar:", JSON.stringify(result));
  return result;
});

ipcMain.handle("jarvis:send", async (_event, input) => {
  lastInteractionTime = Date.now();
  const core = await loadCore();
  const screenshot = pendingScreenshotBase64;
  pendingScreenshotBase64 = null;
  const windowContext = buildWindowContext();
  const result = await core.handleJarvisInput(input, screenshot, windowContext);

  if (!result.shouldContinue) {
    setTimeout(() => app.quit(), 400);
  }

  return result;
});

ipcMain.handle("jarvis:get-proactive", () => {
  const msg = pendingProactiveMessage;
  pendingProactiveMessage = null;
  return msg;
});

function getMouseHookScript() {
  return `
$ErrorActionPreference = "Stop"
Add-Type -TypeDefinition @"
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;

namespace JarvisMouseHook
{
  public static class Program
  {
    private const int WH_MOUSE_LL = 14;
    private const int WM_MBUTTONDOWN = 0x0207;
    private const int WM_MBUTTONUP = 0x0208;
    private static LowLevelMouseProc _proc = HookCallback;
    private static IntPtr _hookID = IntPtr.Zero;

    public static void Run()
    {
      _hookID = SetHook(_proc);
      MSG msg;
      while (GetMessage(out msg, IntPtr.Zero, 0, 0)) {}
      UnhookWindowsHookEx(_hookID);
    }

    private static IntPtr SetHook(LowLevelMouseProc proc)
    {
      using (Process curProcess = Process.GetCurrentProcess())
      using (ProcessModule curModule = curProcess.MainModule)
      {
        return SetWindowsHookEx(WH_MOUSE_LL, proc, GetModuleHandle(curModule.ModuleName), 0);
      }
    }

    private delegate IntPtr LowLevelMouseProc(int nCode, IntPtr wParam, IntPtr lParam);

    private static IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam)
    {
      if (nCode >= 0)
      {
        int message = wParam.ToInt32();
        if (message == WM_MBUTTONDOWN)
        {
          string info = GetWindowInfo();
          if (!string.IsNullOrEmpty(info)) { Console.WriteLine("WINDOW:" + info); }
          Console.WriteLine("MIDDLE_DOWN");
          Console.Out.Flush();
          return (IntPtr)1;
        }
        if (message == WM_MBUTTONUP)
        {
          Console.WriteLine("MIDDLE_UP");
          Console.Out.Flush();
          return (IntPtr)1;
        }
      }

      return CallNextHookEx(_hookID, nCode, wParam, lParam);
    }

    private static string GetWindowInfo()
    {
      try
      {
        IntPtr hwnd = GetForegroundWindow();
        var title = new System.Text.StringBuilder(256);
        GetWindowText(hwnd, title, 256);
        uint pid;
        GetWindowThreadProcessId(hwnd, out pid);
        string proc = "";
        IntPtr hp = OpenProcess(0x1000, false, pid);
        if (hp != IntPtr.Zero)
        {
          var name = new System.Text.StringBuilder(260);
          int sz = 260;
          if (QueryFullProcessImageName(hp, 0, name, ref sz))
            proc = System.IO.Path.GetFileNameWithoutExtension(name.ToString());
          CloseHandle(hp);
        }
        string t = title.ToString().Trim().Replace("|", "·").Replace("\n", " ");
        if (string.IsNullOrEmpty(proc)) return "";
        return proc + "|" + t;
      }
      catch { return ""; }
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct POINT
    {
      public int x;
      public int y;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MSG
    {
      public IntPtr hwnd;
      public uint message;
      public UIntPtr wParam;
      public IntPtr lParam;
      public uint time;
      public POINT pt;
    }

    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern IntPtr SetWindowsHookEx(int idHook, LowLevelMouseProc lpfn, IntPtr hMod, uint dwThreadId);

    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool UnhookWindowsHookEx(IntPtr hhk);

    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern IntPtr GetModuleHandle(string lpModuleName);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetMessage(out MSG lpMsg, IntPtr hWnd, uint wMsgFilterMin, uint wMsgFilterMax);

    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll", CharSet = CharSet.Auto)] private static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder sb, int nMax);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);
    [DllImport("kernel32.dll")] private static extern IntPtr OpenProcess(int access, bool inherit, uint pid);
    [DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr h);
    [DllImport("kernel32.dll", CharSet = CharSet.Auto)] private static extern bool QueryFullProcessImageName(IntPtr h, int flags, System.Text.StringBuilder sb, ref int size);

  }
}
"@
[JarvisMouseHook.Program]::Run()
`;
}
