// Quick search: a sentence, in English or Indonesian, turned into the player list's filters. "striker lokal u23 pa 140+
// value < 5B", "kiper asing umur 25-30 gaji max 100jt", "free agent dc ca 120". No AI and no network: words and numbers
// it knows become filters, and the words it does not know are said, so the user sees what was understood.

import { NO_PLAYER_FILTERS, type PlayerFilterFields } from "./PlayerFilters";

/** What a sentence came to: the filters, what each part was read as, and the words left over. */
export interface QuickResult {
  fields: PlayerFilterFields;
  /** One short line per filter understood, e.g. "position: ST", "age ≤ 23". */
  understood: string[];
  unknown: string[];
}

/** Words that name a position (several words joined by a space), by position key. Longest first when matched. */
const POSITION_WORDS: [string, string][] = [
  ["gk", "gk"], ["kiper", "gk"], ["keeper", "gk"], ["goalkeeper", "gk"], ["penjaga gawang", "gk"],
  ["bek tengah", "dc"], ["centre back", "dc"], ["center back", "dc"], ["cb", "dc"], ["dc", "dc"], ["stopper", "dc"],
  ["bek kiri", "dl"], ["left back", "dl"], ["lb", "dl"], ["dl", "dl"],
  ["bek kanan", "dr"], ["right back", "dr"], ["rb", "dr"], ["dr", "dr"],
  ["wing back kiri", "wbl"], ["wbl", "wbl"], ["lwb", "wbl"],
  ["wing back kanan", "wbr"], ["wbr", "wbr"], ["rwb", "wbr"],
  ["gelandang bertahan", "dm"], ["defensive midfielder", "dm"], ["dm", "dm"], ["cdm", "dm"],
  ["gelandang serang", "amc"], ["attacking midfielder", "amc"], ["amc", "amc"], ["cam", "amc"], ["am", "amc"],
  ["gelandang tengah", "mc"], ["gelandang", "mc"], ["central midfielder", "mc"], ["midfielder", "mc"], ["mc", "mc"],
  ["cm", "mc"],
  ["sayap kiri", "aml"], ["winger kiri", "aml"], ["left winger", "aml"], ["lw", "aml"], ["aml", "aml"],
  ["sayap kanan", "amr"], ["winger kanan", "amr"], ["right winger", "amr"], ["rw", "amr"], ["amr", "amr"],
  ["gelandang kiri", "ml"], ["ml", "ml"], ["lm", "ml"],
  ["gelandang kanan", "mr"], ["mr", "mr"], ["rm", "mr"],
  ["striker", "st"], ["penyerang", "st"], ["forward", "st"], ["st", "st"], ["cf", "st"], ["ujung tombak", "st"],
];

/** Indonesian names of nations, as the game names them in English. Other names are passed on as typed. */
const NATION_WORDS: Record<string, string> = {
  indonesia: "Indonesia", brasil: "Brazil", brazil: "Brazil", jepang: "Japan", japan: "Japan", korea: "Korea",
  belanda: "Netherlands", inggris: "England", spanyol: "Spain", jerman: "Germany", prancis: "France",
  perancis: "France", italia: "Italy", argentina: "Argentina", portugal: "Portugal", malaysia: "Malaysia",
  thailand: "Thailand", vietnam: "Vietnam", singapura: "Singapore", australia: "Australia", belgia: "Belgium",
  kroasia: "Croatia", serbia: "Serbia", nigeria: "Nigeria", ghana: "Ghana", kamerun: "Cameroon", maroko: "Morocco",
  uruguay: "Uruguay", kolombia: "Colombia", "amerika serikat": "United States", usa: "United States",
  filipina: "Philippines", "arab saudi": "Saudi Arabia", iran: "Iran", turki: "Türkiye", turkey: "Türkiye",
};

/** Money words and letters, as FM writes amounts (K, M, B, T) and as Indonesian says them. */
const UNITS: Record<string, number> = {
  k: 1e3, rb: 1e3, ribu: 1e3, m: 1e6, jt: 1e6, juta: 1e6, b: 1e9, miliar: 1e9, milyar: 1e9, t: 1e12, triliun: 1e12,
};

const BELOW = ["<", "<=", "max", "maks", "maksimal", "under", "below", "bawah", "kurang", "di bawah", "paling banyak", "≤"];
const ABOVE = [">", ">=", "min", "minimal", "over", "above", "atas", "lebih", "di atas", "paling sedikit", "≥"];

/** An amount such as "5B", "1.2b", "100jt", "250 juta", "50k", or a plain number; null for none. */
function money(number: string, unit: string | undefined): number | null {
  const value = Number(number.replace(",", "."));
  if (!Number.isFinite(value)) {
    return null;
  }
  return Math.round(value * (unit ? (UNITS[unit] ?? 1) : 1));
}

/**
 * Reads `sentence` into filters. `homeNation` is the managed club's country, for "lokal" and "asing"; `formatAmount`
 * writes an amount back for the summary.
 */
export function parseQuickSearch(
  sentence: string,
  homeNation: string | null,
  formatAmount: (shown: number) => string,
): QuickResult {
  const fields: PlayerFilterFields = { ...NO_PLAYER_FILTERS, attributes: [] };
  const understood: string[] = [];
  // Words understood that cannot be applied: "lokal" and "asing" before the managed club's country is known.
  const unusable: string[] = [];
  // Lower case, accents kept; punctuation that joins nothing becomes space, and "u-23" becomes "u23".
  let rest = ` ${sentence.toLowerCase().replace(/(?<!\d),|,(?!\d)|[;!?]/g, " ").replace(/\bu-(\d)/g, "u$1").replace(/\s+/g, " ")} `;
  const take = (pattern: RegExp, onMatch: (m: RegExpMatchArray) => void) => {
    let found = rest.match(pattern);
    while (found) {
      onMatch(found);
      rest = rest.replace(found[0], " ");
      found = rest.match(pattern);
    }
  };
  // Longest first, so that "<=" is not read as "<" and "di bawah" not as "bawah".
  const alternatives = (words: string[]) =>
    `(?:${[...words].sort((x, y) => y.length - x.length).map((w) => w.replace(/[<>=]/g, "\\$&")).join("|")})`;
  const below = alternatives(BELOW);
  const above = alternatives(ABOVE);
  const num = "(\\d+(?:[.,]\\d+)?)";
  const unit = `\\s?(k|rb|ribu|m|jt|juta|b|miliar|milyar|t|triliun)?`;

  // Abilities: "ca 120+", "pa >= 140", "pa di atas 140", "ca max 130", "pa 140-170", "ca 120".
  for (const [word, min, max, name] of [
    ["ca", "minCurrentAbility", "maxCurrentAbility", "CA"],
    ["pa", "minPotentialAbility", "maxPotentialAbility", "PA"],
  ] as const) {
    take(new RegExp(` ${word}\\s?(\\d+)\\s?-\\s?(\\d+) `), (m) => {
      fields[min] = m[1];
      fields[max] = m[2];
      understood.push(`${name} ${m[1]}–${m[2]}`);
    });
    take(new RegExp(` ${word}\\s?${below}\\s?(\\d+) `), (m) => {
      fields[max] = m[1];
      understood.push(`${name} ≤ ${m[1]}`);
    });
    take(new RegExp(` ${word}\\s?(?:${above}\\s?)?(\\d+)\\s?\\+? `), (m) => {
      fields[min] = m[1];
      understood.push(`${name} ≥ ${m[1]}`);
    });
  }

  // Money: value, wage and asking price, below or above an amount.
  for (const [words, min, max, name] of [
    ["(?:nilai|value|transfer value|harga pasar)", "minValue", "maxValue", "value"],
    ["(?:gaji|wage|salary|upah)", "minWage", "maxWage", "wage"],
    ["(?:asking price|harga jual|harga)", "minAskingPrice", "maxAskingPrice", "asking price"],
  ] as const) {
    take(new RegExp(` ${words}\\s?${below}\\s?${num}${unit} `), (m) => {
      const amount = money(m[1], m[2]);
      if (amount !== null) {
        fields[max] = String(amount);
        understood.push(`${name} ≤ ${formatAmount(amount)}`);
      }
    });
    take(new RegExp(` ${words}\\s?(?:${above}\\s?)?${num}${unit}\\s?\\+? `), (m) => {
      const amount = money(m[1], m[2]);
      if (amount !== null) {
        fields[min] = String(amount);
        understood.push(`${name} ≥ ${formatAmount(amount)}`);
      }
    });
  }

  // Age: "u23" / "under 23" / "di bawah 23 tahun", "umur 18-21", "umur 25+", "di atas 30 tahun".
  take(/ (?:umur|usia|age|aged)?\s?(\d{2})\s?-\s?(\d{2})(?: tahun| th| yo)? /, (m) => {
    fields.minAge = m[1];
    fields.maxAge = m[2];
    understood.push(`age ${m[1]}–${m[2]}`);
  });
  take(/ (?:u|under |umur di bawah |di bawah |usia di bawah |max umur |umur max )(\d{2})(?: tahun| th)? /, (m) => {
    fields.maxAge = m[1];
    understood.push(`age ≤ ${m[1]}`);
  });
  take(/ (?:umur |usia |age )?(?:di atas |over |min umur |umur min )?(\d{2})\s?\+(?: tahun)? | (?:umur|usia) di atas (\d{2})(?: tahun)? /, (m) => {
    const age = m[1] ?? m[2];
    fields.minAge = age;
    understood.push(`age ≥ ${age}`);
  });
  take(/ (?:umur|usia|age) (\d{2})(?: tahun)? /, (m) => {
    fields.minAge = m[1];
    fields.maxAge = m[1];
    understood.push(`age ${m[1]}`);
  });

  // Contract: "kontrak habis 2027", "contract ends 2027".
  take(/ (?:kontrak habis|kontrak berakhir|contract ends?|expiring|habis kontrak)\s?(?:tahun |in )?(20\d\d)? /, (m) => {
    const year = m[1] ?? String(new Date().getFullYear());
    fields.contractExpiresBy = `${year}-12-31`;
    understood.push(`contract ends by ${year}`);
  });

  // Who: free agents, the transfer and loan lists.
  take(/ (?:free agents?|bebas transfer|tanpa klub|free transfer|pemain bebas) /, () => {
    fields.freeAgents = true;
    understood.push("free agents");
  });
  take(/ (?:transfer list(?:ed)?|dijual|masuk daftar jual) /, () => {
    fields.transferListed = true;
    understood.push("transfer listed");
  });
  take(/ (?:loan list(?:ed)?|bisa dipinjam|dipinjamkan) /, () => {
    fields.loanListed = true;
    understood.push("loan listed");
  });

  // Local and foreign, by the managed club's country.
  take(/ (?:lokal|local|domestik|domestic|pemain lokal) /, () => {
    if (homeNation) {
      fields.nation = homeNation;
      understood.push(`nation: ${homeNation}`);
    } else {
      unusable.push("lokal");
    }
  });
  take(/ (?:asing|foreign|import|pemain asing) /, () => {
    if (homeNation) {
      fields.excludeNation = homeNation;
      understood.push(`not ${homeNation}`);
    } else {
      unusable.push("asing");
    }
  });

  // Positions, longest words first so "bek kiri" is not read as two words.
  for (const [words, key] of [...POSITION_WORDS].sort((a, b) => b[0].length - a[0].length)) {
    if (fields.position) {
      break;
    }
    take(new RegExp(` ${words} `), () => {
      if (!fields.position) {
        fields.position = key;
        understood.push(`position: ${key.toUpperCase()}`);
      }
    });
  }

  // Nations by name.
  for (const [word, nation] of Object.entries(NATION_WORDS).sort((a, b) => b[0].length - a[0].length)) {
    if (fields.nation) {
      break;
    }
    take(new RegExp(` ${word} `), () => {
      fields.nation = nation;
      understood.push(`nation: ${nation}`);
    });
  }

  // Words that carry nothing on their own are dropped; the rest are said as not understood.
  const filler = new Set([
    "yang", "dan", "and", "with", "dengan", "di", "ke", "cari", "find", "pemain", "player", "players", "tahun",
    "the", "a", "untuk", "for", "dari", "from", "mau", "butuh", "need", "tim", "klub",
  ]);
  const unknown = rest
    .trim()
    .split(" ")
    .filter((word) => word !== "" && !filler.has(word));
  return { fields, understood, unknown: [...unusable, ...unknown] };
}
