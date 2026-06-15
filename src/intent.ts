export type Intent = "chat" | "note" | "code" | "calendar" | "training";

export type IntentResult = {
  intent: Intent;
  confidence: number;
};

export async function classifyIntent(text: string): Promise<IntentResult> {
  if (!process.env.OPENAI_API_KEY) {
    return { intent: "chat", confidence: 1 };
  }

  const model = process.env.OPENAI_CLASSIFIER_MODEL || "gpt-4o-mini";

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 60,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: [
              'Klassificera meddelandet i ett intent. Svara med JSON: {"intent":"chat|note|code|calendar|training","confidence":0.0-1.0}',
              '"chat" — samtal, frågor, diskussion, tankar högt',
              '"note" — vill spara en notering, tanke, påminnelse eller faktum för senare (inte kalenderbokningar)',
              '"code" — vill ha kod skriven: funktion, skript, klass, SQL, config',
              '"calendar" — vill se, boka, lägga till, flytta, ändra, avboka eller ta bort saker i sin kalender',
              '"training" — frågor om träning/pass/övningar: vad ska jag träna, har vi pass, nästa pass, dagens pass, hur ligger jag till med träningen, planen för passet'
            ].join("\n")
          },
          { role: "user", content: text }
        ]
      })
    });

    if (!response.ok) {
      return { intent: "chat", confidence: 1 };
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const raw = data.choices?.[0]?.message?.content || "{}";
    const parsed = JSON.parse(raw) as { intent?: string; confidence?: number };
    const intent = (["chat", "note", "code", "calendar", "training"].includes(parsed.intent ?? "") ? parsed.intent : "chat") as Intent;
    return { intent, confidence: parsed.confidence ?? 0.9 };
  } catch {
    return { intent: "chat", confidence: 1 };
  }
}
