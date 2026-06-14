const EXERCISE_GUIDES: Record<string, string> = {
  "Handled- & axelprep":
    "Värm handleder och axlar innan du belastar dem. Gör lugna cirklar, luta lätt fram över händerna och känn att handlederna klarar trycket.",
  "Handstativ mot vägg":
    "Sätt händerna stadigt i golvet och gå eller kicka upp mot väggen. Spänn mage och rumpa, tryck axlarna upp mot öronen och håll kroppen så rak som möjligt.",
  "Pseudo planche-lutning":
    "Stå i armhävningsposition med raka armar. Luta axlarna fram framför händerna tills det känns tungt i axlar och bål, utan att tappa skulderkontroll.",
  "Armhävningar":
    "Håll kroppen rak från huvud till häl. Sänk bröstet kontrollerat, pressa upp starkt och låt armbågarna följa en naturlig vinkel.",
  "Pike push-ups":
    "Placera höften högt som ett uppochnervänt V. Sänk huvudet mot golvet mellan händerna och pressa upp med axlarna.",
  "Hollow hold":
    "Ligg på rygg och pressa ländryggen ner i golvet. Lyft skuldror och ben, håll revbenen nere och andas kontrollerat.",
  "Side plank":
    "Placera armbågen under axeln och håll kroppen i en rak linje. Pressa höften uppåt och undvik att rotera framåt eller bakåt.",
  "Liggande benlyft":
    "Ligg på rygg, håll bålen spänd och lyft benen kontrollerat. Sänk utan att svanka eller tappa kontakt med golvet.",
  "Split squats / pistol-prog.":
    "Stå i delad position och sänk kontrollerat rakt ner. Håll främre knät stabilt, bröstet högt och tryck upp genom hela foten.",
  "Scapula-pulls i stången":
    "Häng med raka armar. Dra skulderbladen nedåt och lätt ihop utan att böja armbågarna, sänk sedan kontrollerat tillbaka.",
  "Tuck front lever":
    "Häng i stången med raka armar, dra ner skuldrorna och luta kroppen bakåt. Dra in knäna mot bröstet och försök få ryggen nära horisontell.",
  "Flagg-försök (om stolpe finns)":
    "Greppa stolpen med händerna isär. Tryck med nedre armen, dra med övre och gör små kontrollerade sidolyft. Det ska kännas som tryck/dra, inte klättring.",
  "Pull-ups":
    "Starta från häng med raka armar. Dra skuldrorna nedåt först, dra sedan hakan över stången och sänk kontrollerat utan gung.",
  "Australiska rows (under barren)":
    "Ligg under en låg stång med kroppen rak. Dra bröstet mot stången, håll skuldrorna aktiva och sänk långsamt.",
  "Dips på barren":
    "Håll dig uppe mellan parallella räcken. Sänk tills armbågarna är böjda, håll axlarna kontrollerade och pressa upp utan att studsa.",
  "Hängande knälyft":
    "Häng från stången och lyft knäna mot bröstet. Undvik sving genom att spänna bålen och sänka benen långsamt.",
};

export function exerciseGuide(name: string) {
  return EXERCISE_GUIDES[name] ?? "Gör övningen kontrollerat med ren teknik. Avbryt om formen faller eller om något gör ont.";
}
