# Jarvis

En personlig AI-narvaro for Jimmy. Inte en artig assistent. En lojal, kaxig och skarp digital kollega med pondus.

## v0.1 Minimal Narvaro

Målet med första versionen är enkelt:

- prata med Jarvis i en lokal text-loop
- få korta svar med personlighet
- spara samtal lokalt i SQLite
- spara minnen och jargong explicit
- bygga grunden innan röst, hotkey och overlay kopplas på

## Kom igang

```bash
npm install
npm run dev
```

Utan API-nyckel kör Jarvis i mock-läge. Med `OPENAI_API_KEY` i `.env` väljer Jarvis OpenAI automatiskt. Vill du styra själv kan du sätta `JARVIS_PROVIDER=openai`, `anthropic`, `mock` eller `auto`.

OpenAI-standard:

```txt
JARVIS_PROVIDER=auto
OPENAI_MODEL=gpt-4o-mini
```

Anthropic-standard:

```txt
JARVIS_PROVIDER=anthropic
ANTHROPIC_API_KEY=...
JARVIS_MODEL=...
```

## Windows-app

Starta desktopläget under utveckling:

```bash
npm run desktop
```

Bygg Windows-appen:

```bash
npm run dist:win
```

Den körbara filen hamnar här:

```txt
release/win-unpacked/Jarvis.exe
```

Appen har nu:

- system tray-närvaro
- liten always-on-top `J`-knapp som visar och fokuserar Jarvis
- håll inne scroll-knappen på musen för push-to-talk
- `Ctrl+Alt+J` eller `F8` som backup
- stäng fönstret för att gömma appen i tray
- röst-toggle som läser upp Jarvis svar med inbyggd TTS

Push-to-talk kräver `OPENAI_API_KEY` i `.env` för transkribering. Standardmodellen är `gpt-4o-transcribe` för bättre kvalitet.

Transkriberingen använder även en liten efterputsning med ordlista/jargong. Lägg egna ord i `.env` så här:

```txt
JARVIS_TRANSCRIBE_TERMS=Sintari Display,Töreboda,mitt interna uttryck
```

Vill du stänga av efterputsningen:

```txt
OPENAI_TRANSCRIPT_REFINEMENT=false
```

## Kommandon

```txt
/exit
/remember Sintari Display är prio före Jarvis just nu
/jargon nu skiter du i det blåa skåpet = jag går för långt eller tappar fokus
/reflect
/improvements
/improve titel = problem -> förslag
/handoff
/done 3
/memories
/jargon
/calendar
/today
/tomorrow
```

## Telegram och kalender

Jarvis kan ta emot text och röstmeddelanden via Telegram om dessa finns i `.env`:

```txt
TELEGRAM_BOT_TOKEN=...
TELEGRAM_USER_ID=...
JARVIS_TELEGRAM_VOICE=true
```

`npm run desktop` startar Telegram-boten i bakgrunden. `npm run dev` gör det också, så länge variablerna ovan finns.

När Telegram-boten är igång skickar Jarvis en daglig BRAK-påminnelse kl. 05:00 Europe/Stockholm med armhävningar, ryggresningar, jägarvila och knäböj. Med `OPENAI_API_KEY` får meddelandet också en unik kort morgonpuff varje dag, annars används en lokal fallback-text.

Kalendern läser en privat iCal/ICS-länk:

```txt
JARVIS_CALENDAR_ICS_URL=https://...
```

I Google Calendar hittar du den under kalenderns inställningar som "Secret address in iCal format". Flera kalendrar kan anges kommaseparerat.

Kalenderfraser som fungerar:

```txt
/calendar
/today
/tomorrow
vad händer idag
kalender imorgon
schema
```

## Railway deploy

Railway ska köra Jarvis som en headless Telegram-worker, inte som Electron-app.

Lokalt kan du testa samma process med:

```bash
npm run bot
```

I Railway används:

```bash
npm run build
npm start
```

Lägg dessa i Railway under service `Variables`:

```txt
TELEGRAM_BOT_TOKEN=...
TELEGRAM_USER_ID=...
JARVIS_TELEGRAM_VOICE=false
JARVIS_CALENDAR_ICS_URL=...
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-4o-mini
JARVIS_PROVIDER=auto
```

Tips: sätt `JARVIS_TELEGRAM_VOICE=false` i Railway först. Då slipper servern generera röstsvar innan textflödet är bekräftat.

Deployflöde:

```bash
git add .
git commit -m "Add Telegram worker for Railway"
git remote add origin https://github.com/<user>/<repo>.git
git push -u origin master
```

Skapa sedan ett nytt Railway-projekt från GitHub-repot. Railway läser `railway.json`, bygger TypeScript och startar `node dist/bot.js`.

Självförbättringsflödet är medvetet approval-first:

- Jarvis ser och loggar brister
- Jarvis föreslår förbättringar
- `/handoff` skapar en Codex-vänlig fixlista
- kodändringar sker först efter att Jimmy säger kör

## Nästa lager

- global push-to-talk hotkey
- mic capture
- Whisper/transkribering
- TTS-röst tillbaka
- system tray-status: sover, lyssnar, tänker, pratar
- kill switch
