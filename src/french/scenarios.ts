/**
 * Scen-bibliotek för trevliga, varierande lektioner.
 *
 * Lektionerna är små vardagsscener med återkommande karaktärer (Anna & Simone
 * i centrum) i olika miljöer. Det deterministiska lagret väljer scen + ord;
 * LLM:en gjuter själva dialogen på franska, anpassad till nivån.
 */

export interface Scene {
  id: string;
  setting_sv: string;
  setting_fr: string;
  hint: string; // vad scenen naturligt övar – vägledning till LLM:en
}

/** Den fasta ensemblen som återkommer mellan lektioner. */
export const CAST =
  "Anna (svensk, lär sig franska) och hennes franska väninna Simone. Ibland dyker Marc (Simones bror), Léa (servitris) eller Monsieur Dubois (granne) upp.";

export const SCENES: Scene[] = [
  { id: "cafe", setting_sv: "på ett café", setting_fr: "au café", hint: "hälsa, beställa kaffe/bröd, småprata, artighetsfraser" },
  { id: "marche", setting_sv: "på marknaden", setting_fr: "au marché", hint: "handla, fråga om pris, siffror, mat" },
  { id: "gare", setting_sv: "på tågstationen", setting_fr: "à la gare", hint: "fråga om tid och väg, biljett, klockan" },
  { id: "maison", setting_sv: "hemma hos Anna", setting_fr: "chez Anna", hint: "presentera familj och hem, vardagsord" },
  { id: "telephone", setting_sv: "i telefon", setting_fr: "au téléphone", hint: "ringa, planera att ses, dagar och tid" },
  { id: "boulangerie", setting_sv: "i bageriet", setting_fr: "à la boulangerie", hint: "köpa bröd, artighet, antal" },
  { id: "parc", setting_sv: "i parken", setting_fr: "dans le parc", hint: "väder, småprat, hur mår du" },
  { id: "restaurant", setting_sv: "på restaurang", setting_fr: "au restaurant", hint: "beställa mat och dryck, artighet" },
  { id: "rencontre", setting_sv: "ett första möte", setting_fr: "une première rencontre", hint: "presentera sig, namn, varifrån man kommer" },
  { id: "rue", setting_sv: "ute på stan", setting_fr: "dans la rue", hint: "fråga om vägen, hälsa, var ligger X" }
];

/** Väljer en scen, undviker den senaste för variation. */
export function pickScene(lastSceneId?: string | null): Scene {
  const pool = SCENES.filter((s) => s.id !== lastSceneId);
  const list = pool.length > 0 ? pool : SCENES;
  return list[Math.floor(Math.random() * list.length)];
}
