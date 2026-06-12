const messages = document.getElementById("messages");
const composer = document.getElementById("composer");
const input = document.getElementById("input");
const status = document.getElementById("status");
const voiceToggle = document.getElementById("voiceToggle");
const chatTab = document.getElementById("chatTab");
const calendarTab = document.getElementById("calendarTab");
const chatView = document.getElementById("chatView");
const calendarView = document.getElementById("calendarView");
const calendarForm = document.getElementById("calendarForm");
const calendarList = document.getElementById("calendarList");
const refreshCalendar = document.getElementById("refreshCalendar");
const eventDate = document.getElementById("eventDate");
const eventStart = document.getElementById("eventStart");
let speakReplies = localStorage.getItem("jarvis:speakReplies") !== "false";
let micStream = null;
let mediaRecorder = null;
let recordedChunks = [];
let isRecording = false;
let recordingStartedAt = 0;
let currentAudio = null;
let speakGeneration = 0;
let stopRecordingTimeout = null;

addMessage(
  "jarvis",
  "Jag är igång. Håll inne scroll-knappen och prata. Släpp så svarar jag. Enkelt, som det ska vara."
);

syncVoiceButton();
setDefaultCalendarInputs();
loadCalendarEvents();

window.jarvis.onFocusInput(() => {
  input.focus();
  input.select();
});

window.jarvis.onPushToTalkStart(() => {
  startPushToTalk();
});

window.jarvis.onPushToTalkStop(() => {
  stopPushToTalk();
});

window.jarvis.onProactiveMessage((message) => {
  addMessage("jarvis", message);
  speak(message);
});


voiceToggle.addEventListener("click", () => {
  speakReplies = !speakReplies;
  localStorage.setItem("jarvis:speakReplies", String(speakReplies));
  syncVoiceButton();

  if (!speakReplies) {
    stopCurrentSpeech();
    status.textContent = "redo";
  }
});

chatTab.addEventListener("click", () => {
  setActiveView("chat");
});

calendarTab.addEventListener("click", () => {
  setActiveView("calendar");
  loadCalendarEvents();
});

refreshCalendar.addEventListener("click", () => {
  loadCalendarEvents();
});

calendarForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const form = new FormData(calendarForm);
  const title = String(form.get("title") || "").trim();
  const date = String(form.get("date") || "");
  const start = String(form.get("start") || "");
  const end = String(form.get("end") || "");
  const location = String(form.get("location") || "").trim();
  const notes = String(form.get("notes") || "").trim();

  if (!title || !date || !start) {
    return;
  }

  await window.jarvis.calendar.add({
    title,
    startsAt: new Date(`${date}T${start}:00`).toISOString(),
    endsAt: end ? new Date(`${date}T${end}:00`).toISOString() : null,
    location,
    notes
  });

  calendarForm.reset();
  setDefaultCalendarInputs();
  await loadCalendarEvents();
});

composer.addEventListener("submit", async (event) => {
  event.preventDefault();

  const value = input.value.trim();
  if (!value) {
    return;
  }

  input.value = "";
  await sendToJarvis(value);
});

input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    composer.requestSubmit();
  }
});

function addMessage(author, text, intent) {
  const article = document.createElement("article");
  article.className = `message ${author}`;

  const label = document.createElement("span");
  label.className = "label";
  label.textContent = author === "user" ? "Jimmy" : "Jarvis";

  if (intent && intent !== "chat") {
    const tag = document.createElement("span");
    tag.className = `intent-tag intent-${intent}`;
    tag.textContent = intent;
    label.append(" ", tag);
  }

  const body = document.createElement("div");
  renderContent(body, text);

  article.append(label, body);
  messages.append(article);
  chatView.scrollTop = chatView.scrollHeight;
}

function renderContent(container, text) {
  const codeBlockRe = /```(\w*)\n?([\s\S]*?)```/g;
  let lastIndex = 0;
  let match;

  while ((match = codeBlockRe.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const span = document.createElement("span");
      span.textContent = text.slice(lastIndex, match.index);
      container.append(span);
    }

    const pre = document.createElement("pre");
    const code = document.createElement("code");
    code.textContent = match[2].trim();
    pre.append(code);
    container.append(pre);
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    const span = document.createElement("span");
    span.textContent = text.slice(lastIndex);
    container.append(span);
  }
}

async function sendToJarvis(value) {
  addMessage("user", value);
  status.textContent = "tänker";

  try {
    const result = await window.jarvis.send(value);
    if (result.reply) {
      addMessage("jarvis", result.reply, result.intent);
      speak(result.reply);
      if (result.reply.includes("Inlagt i kalendern")) {
        loadCalendarEvents();
      }
    }
  } catch (error) {
    addMessage("jarvis", `Något small: ${error.message || String(error)}`);
  } finally {
    if (!speechSynthesis.speaking) {
      status.textContent = "redo";
    }
    input.focus();
  }
}

function setActiveView(view) {
  const isCalendar = view === "calendar";
  chatView.classList.toggle("active", !isCalendar);
  calendarView.classList.toggle("active", isCalendar);
  chatTab.classList.toggle("active", !isCalendar);
  calendarTab.classList.toggle("active", isCalendar);
  chatTab.setAttribute("aria-selected", String(!isCalendar));
  calendarTab.setAttribute("aria-selected", String(isCalendar));
}

function setDefaultCalendarInputs() {
  const now = new Date();
  eventDate.value = now.toISOString().slice(0, 10);
  const nextHour = new Date(now);
  nextHour.setMinutes(0, 0, 0);
  nextHour.setHours(nextHour.getHours() + 1);
  eventStart.value = nextHour.toTimeString().slice(0, 5);
}

async function loadCalendarEvents() {
  if (!window.jarvis?.calendar) {
    return;
  }

  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 45);

  try {
    const events = await window.jarvis.calendar.list(start.toISOString(), end.toISOString());
    renderCalendarEvents(events);
  } catch (error) {
    calendarList.innerHTML = "";
    const empty = document.createElement("div");
    empty.className = "calendar-empty";
    empty.textContent = `Kalendern small: ${error.message || String(error)}`;
    calendarList.append(empty);
  }
}

function renderCalendarEvents(events) {
  calendarList.innerHTML = "";

  if (!events || events.length === 0) {
    const empty = document.createElement("div");
    empty.className = "calendar-empty";
    empty.textContent = "Inga lokala händelser än.";
    calendarList.append(empty);
    return;
  }

  const grouped = groupEventsByDate(events);
  for (const [dateKey, items] of grouped) {
    const group = document.createElement("section");
    group.className = "calendar-day";

    const heading = document.createElement("h3");
    heading.textContent = formatDateHeading(dateKey);
    group.append(heading);

    for (const event of items) {
      group.append(renderCalendarEvent(event));
    }

    calendarList.append(group);
  }
}

function renderCalendarEvent(event) {
  const item = document.createElement("article");
  item.className = "calendar-event";

  const time = document.createElement("div");
  time.className = "calendar-time";
  time.textContent = formatEventTime(event);

  const body = document.createElement("div");
  body.className = "calendar-event-body";

  const title = document.createElement("strong");
  title.textContent = event.title;
  body.append(title);

  const metaParts = [event.location, event.source === "jarvis" ? "Jarvis" : "Manuell"].filter(Boolean);
  if (metaParts.length > 0 || event.notes) {
    const meta = document.createElement("span");
    meta.textContent = [metaParts.join(" · "), event.notes].filter(Boolean).join(" — ");
    body.append(meta);
  }

  const remove = document.createElement("button");
  remove.className = "icon-button";
  remove.type = "button";
  remove.title = "Ta bort";
  remove.textContent = "×";
  remove.addEventListener("click", async () => {
    await window.jarvis.calendar.delete(event.id);
    await loadCalendarEvents();
  });

  item.append(time, body, remove);
  return item;
}

function groupEventsByDate(events) {
  const map = new Map();
  for (const event of events) {
    const key = new Date(event.startsAt).toISOString().slice(0, 10);
    if (!map.has(key)) {
      map.set(key, []);
    }
    map.get(key).push(event);
  }
  return map;
}

function formatDateHeading(dateKey) {
  return new Date(`${dateKey}T12:00:00`).toLocaleDateString("sv-SE", {
    weekday: "long",
    day: "numeric",
    month: "long"
  });
}

function formatEventTime(event) {
  const start = new Date(event.startsAt).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" });
  if (!event.endsAt) {
    return start;
  }
  const end = new Date(event.endsAt).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" });
  return `${start}-${end}`;
}

async function startPushToTalk() {
  clearTimeout(stopRecordingTimeout);
  stopRecordingTimeout = null;

  if (isRecording) {
    return;
  }

  try {
    micStream ||= await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1
      }
    });
    recordedChunks = [];
    mediaRecorder = new MediaRecorder(micStream, getRecorderOptions());

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        recordedChunks.push(event.data);
      }
    };

    mediaRecorder.onstop = handleRecordingStop;
    mediaRecorder.start(250);
    isRecording = true;
    recordingStartedAt = Date.now();
    status.textContent = "lyssnar";
    document.body.classList.add("recording");
    playListeningBeep();
  } catch (error) {
    addMessage("jarvis", `Jag fick inte tag i mikrofonen: ${error.message || String(error)}`);
    status.textContent = "redo";
  }
}

function stopPushToTalk() {
  if (!isRecording || !mediaRecorder) {
    return;
  }

  stopRecordingTimeout = setTimeout(() => {
    if (!isRecording || !mediaRecorder) return;
    status.textContent = "transkriberar";
    document.body.classList.remove("recording");
    mediaRecorder.requestData();
    mediaRecorder.stop();
    isRecording = false;
  }, 400);
}

async function handleRecordingStop() {
  try {
    if (recordedChunks.length === 0) {
      status.textContent = "redo";
      return;
    }

    const blob = new Blob(recordedChunks, { type: mediaRecorder?.mimeType || "audio/webm" });
    const durationMs = Date.now() - recordingStartedAt;

    if (durationMs < 350) {
      status.textContent = "redo";
      return;
    }

    const audio = await blob.arrayBuffer();
    console.log(`[Jarvis mic] ${durationMs}ms, ${audio.byteLength} bytes, ${blob.type}`);
    const result = await window.jarvis.transcribe(audio, blob.type, durationMs);
    const transcript = result?.transcript ?? result;

    if (!transcript) {
      status.textContent = "redo";
      return;
    }

    if (result?.raw) {
      addDebugLine(`whisper: "${result.raw}"`);
    }

    await sendToJarvis(transcript);
  } catch (error) {
    addMessage("jarvis", `Jag hörde dig, men transkriberingen small: ${error.message || String(error)}`);
    status.textContent = "redo";
  }
}

function addDebugLine(text) {
  const div = document.createElement("div");
  div.className = "debug-line";
  div.textContent = text;
  messages.append(div);
  chatView.scrollTop = chatView.scrollHeight;
}

function playListeningBeep() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.18, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.1);
  } catch (_) {}
}

function getRecorderOptions() {
  if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) {
    return { mimeType: "audio/webm;codecs=opus" };
  }

  if (MediaRecorder.isTypeSupported("audio/webm")) {
    return { mimeType: "audio/webm" };
  }

  return undefined;
}

function syncVoiceButton() {
  voiceToggle.setAttribute("aria-pressed", String(speakReplies));
  voiceToggle.textContent = speakReplies ? "Röst på" : "Röst av";
}

function stopCurrentSpeech() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
}

async function speak(text) {
  if (!speakReplies || !text) {
    return;
  }

  stopCurrentSpeech();
  const generation = ++speakGeneration;

  try {
    const base64 = await window.jarvis.speak(text);

    if (generation !== speakGeneration) return;

    if (!base64) {
      fallbackSpeak(text);
      return;
    }

    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const blob = new Blob([bytes], { type: "audio/mpeg" });
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    currentAudio = audio;

    audio.onplay = () => {
      status.textContent = "pratar";
    };
    audio.onended = () => {
      URL.revokeObjectURL(url);
      currentAudio = null;
      status.textContent = "redo";
    };
    audio.onerror = () => {
      URL.revokeObjectURL(url);
      currentAudio = null;
      status.textContent = "redo";
    };

    audio.play();
  } catch (error) {
    console.error("[Jarvis TTS]", error);
    status.textContent = "redo";
  }
}

function fallbackSpeak(text) {
  if (!("speechSynthesis" in window)) {
    return;
  }

  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "sv-SE";
  utterance.rate = 1.02;
  utterance.pitch = 0.86;
  utterance.onstart = () => { status.textContent = "pratar"; };
  utterance.onend = () => { status.textContent = "redo"; };
  utterance.onerror = () => { status.textContent = "redo"; };
  speechSynthesis.speak(utterance);
}
