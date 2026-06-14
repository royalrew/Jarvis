import { config as loadEnv } from "dotenv";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EXERCISE_VISUALS } from "../lib/exercise-visuals";

loadEnv({ path: "../.env" });
loadEnv({ path: ".env" });

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const outDir = path.join(root, "public", "exercise-images");
const key = process.env.FAL_KEY || process.env.FAL_AI;
const model = process.env.FAL_IMAGE_MODEL || "fal-ai/flux/schnell";
const generate = process.argv.includes("--generate");
const dryRun = !generate;

const requested = process.argv
  .slice(2)
  .filter((arg) => arg !== "--dry-run" && arg !== "--generate");
const entries = Object.entries(EXERCISE_VISUALS).filter(([name, visual]) => {
  if (requested.length === 0) return true;
  return requested.some((arg) => name.toLowerCase().includes(arg.toLowerCase()) || visual.slug === arg);
});

async function main() {
  if (!key && !dryRun) {
    throw new Error("FAL_KEY eller FAL_AI saknas i root-.env");
  }

  if (entries.length === 0) {
    throw new Error("Inga matchande övningar hittades.");
  }

  await mkdir(outDir, { recursive: true });
  const falClient = dryRun ? null : await import("@fal-ai/client");
  falClient?.fal.config({ credentials: key });

  for (const [name, visual] of entries) {
    const outPath = path.join(outDir, `${visual.slug}.jpg`);
    if (dryRun) {
      console.log(`[dry-run] ${name} -> ${path.relative(root, outPath)}`);
      continue;
    }

    if (!falClient) throw new Error("FAL client saknas.");
    console.log(`Generating ${name} -> ${path.relative(root, outPath)}`);

    const result = (await falClient.fal.subscribe(model, {
      input: {
        prompt: visual.prompt,
        image_size: "landscape_4_3",
        num_images: 1,
        output_format: "jpeg",
      },
    })) as { data?: { images?: { url?: string }[] }; images?: { url?: string }[] };

    const imageUrl = result.data?.images?.[0]?.url ?? result.images?.[0]?.url;
    if (!imageUrl) {
      throw new Error(`FAL returned no image URL for ${name}`);
    }

    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error(`Could not download ${name}: ${response.status} ${response.statusText}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    await writeFile(outPath, buffer);
  }

  console.log(
    dryRun
      ? `Dry run complete. ${entries.length} image(s) would be written to ${path.relative(root, outDir)}`
      : `Done. Wrote ${entries.length} image(s) to ${path.relative(root, outDir)}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
