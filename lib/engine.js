// Pflegetopf – Rechenkern (ohne Browser-Abhängigkeiten, testbar)
// Alle Datumswerte als "JJJJ-MM-TT"-Strings, gerechnet in UTC, damit keine Zeitzonenfehler entstehen.

export const LEISTUNGEN = {
  entlastung: { label: "Entlastungsbetrag", kurz: "Entlastung", minPg: 1 },
  entlastungsbudget: { label: "Verhinderungs- und Kurzzeitpflege", kurz: "Verhinderung/Kurzzeit", minPg: 2 },
  pflegehilfsmittel: { label: "Pflegehilfsmittel zum Verbrauch", kurz: "Pflegehilfsmittel", minPg: 1 },
  wohnumfeld: { label: "Wohnumfeldverbesserung", kurz: "Wohnumfeld", minPg: 1 },
};

// ---------- Datum ----------
export function parseDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ""));
  if (!m) throw new Error("Ungültiges Datum: " + s);
  return { y: +m[1], m: +m[2], d: +m[3] };
}
const pad = (n) => String(n).padStart(2, "0");
export const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const utc = (s) => { const p = parseDate(s); return Date.UTC(p.y, p.m - 1, p.d); };
export const daysBetween = (a, b) => Math.round((utc(b) - utc(a)) / 86400000);
export function addMonths(s, n) {
  const p = parseDate(s);
  const total = p.y * 12 + (p.m - 1) + n;
  const y = Math.floor(total / 12), m = (total % 12) + 1;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return ymd(y, m, Math.min(p.d, last));
}
export const lastDayOfMonth = (y, m) => ymd(y, m, new Date(Date.UTC(y, m, 0)).getUTCDate());
export const formatDate = (s) => { const p = parseDate(s); return `${pad(p.d)}.${pad(p.m)}.${p.y}`; };
export const euro = (n) => (Math.round(n * 100) / 100).toLocaleString("de-DE", { style: "currency", currency: "EUR" });
const round2 = (n) => Math.round(n * 100) / 100;

// ---------- Regeln ----------
const YEAR_KEYS_MAP = ["entlastungsbetragMonat", "entlastungsbudgetJahr", "verhinderungspflegeAngehoerigeJahr", "pflegegeldMonat", "sachleistungMonat", "tagespflegeMonat"];
const YEAR_KEYS_NUM = ["pflegehilfsmittelMonat", "wohnumfeldProMassnahme", "umwandlungProzent", "kurzzeitpflegeWochen", "belegFristFolgejahre"];

export function validateRules(r) {
  const errors = [];
  if (!r || typeof r !== "object") return { ok: false, errors: ["Keine Regeldaten"] };
  if (r.schemaVersion !== 1) errors.push("Unbekannte schemaVersion");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.version || "")) errors.push("version fehlt oder ungültig");
  if (!r.years || typeof r.years !== "object" || !Object.keys(r.years).length) errors.push("years fehlt");
  for (const [year, y] of Object.entries(r.years || {})) {
    if (!/^\d{4}$/.test(year)) errors.push(`Jahr ${year} ungültig`);
    for (const k of YEAR_KEYS_MAP) {
      if (!y[k] || typeof y[k] !== "object") { errors.push(`${year}.${k} fehlt`); continue; }
      for (const [pg, v] of Object.entries(y[k]))
        if (!/^[1-5]$/.test(pg) || typeof v !== "number" || v < 0 || v > 100000) errors.push(`${year}.${k}.${pg} ungültig`);
    }
    for (const k of YEAR_KEYS_NUM)
      if (typeof y[k] !== "number" || y[k] < 0 || y[k] > 100000) errors.push(`${year}.${k} ungültig`);
    if (!/^\d{2}-\d{2}$/.test(y.entlastungsbetragUebertragBis || "")) errors.push(`${year}.entlastungsbetragUebertragBis ungültig`);
    if (!y.beratung || !Array.isArray(y.beratung.pflichtPflegegrade) || typeof y.beratung.intervallMonate !== "number")
      errors.push(`${year}.beratung ungültig`);
  }
  if (r.notices && !Array.isArray(r.notices)) errors.push("notices muss eine Liste sein");
  return { ok: errors.length === 0, errors };
}

// Neuere gültige Regeln übernehmen, sonst die vorhandenen behalten
export function pickNewerRules(current, candidate) {
  if (!validateRules(candidate).ok) return current;
  if (!current || candidate.version > current.version) return candidate;
  return current;
}

// Regeln für ein Jahr; fehlt das Jahr, gilt das letzte bekannte Jahr als Schätzung
export function rulesForYear(rules, year) {
  const ys = rules.years;
  if (ys[String(year)]) return { ...ys[String(year)], year, estimated: !ys[String(year)].confirmed };
  const known = Object.keys(ys).map(Number).sort((a, b) => a - b);
  const base = known.filter((k) => k <= year).pop() ?? known[0];
  return { ...ys[String(base)], year, estimated: true, basedOn: base };
}

// ---------- Hilfen ----------
const inYear = (e, y) => parseDate(e.date).y === y;
const sum = (list) => round2(list.reduce((s, e) => s + (Number(e.amount) || 0), 0));
const entriesFor = (entries, personId, leistung) =>
  entries.filter((e) => e.personId === personId && e.leistung === leistung).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

// Monate mit Anspruch in einem Jahr bis einschließlich Monat upTo
export function monthsActive(person, year, upTo = 12) {
  const s = parseDate(person.pgSince);
  if (s.y > year) return 0;
  const from = s.y === year ? s.m : 1;
  return Math.max(0, upTo - from + 1);
}

// ---------- Entlastungsbetrag (mit Übertrag bis 30.06. des Folgejahres) ----------
export function entlastung(person, entries, today, rules) {
  const t = parseDate(today);
  const own = entriesFor(entries, person.id, "entlastung");
  // Vorsichtig: nur Vorjahr + laufendes Jahr. Ältere Überträge sind spätestens am 30.06. des Vorjahres verfallen.
  const startYear = Math.max(parseDate(person.pgSince).y, t.y - 1);
  let carryIn = 0;
  let result = null;
  for (let yr = startYear; yr <= t.y; yr++) {
    const r = rulesForYear(rules, yr);
    const rate = r.entlastungsbetragMonat[String(person.pflegegrad)] || 0;
    const carryDeadline = ymd(yr, ...r.entlastungsbetragUebertragBis.split("-").map(Number));
    // Restbetrag laut Pflegekasse hat Vorrang vor der eigenen Berechnung
    const restOverride = yr === t.y && person.vorjahresRestJahr === t.y && typeof person.vorjahresRest === "number";
    if (restOverride) carryIn = Math.max(0, person.vorjahresRest);
    const yearTotal = monthsActive(person, yr, 12) * rate;
    const accruedSoFar = yr < t.y ? yearTotal : monthsActive(person, yr, t.m) * rate;
    let carryLeft = carryIn, usedCarry = 0, usedCurrent = 0;
    for (const e of own.filter((e) => inYear(e, yr))) {
      let amt = Number(e.amount) || 0;
      if (e.date <= carryDeadline && carryLeft > 0) {
        const take = Math.min(carryLeft, amt);
        carryLeft -= take; usedCarry += take; amt -= take;
      }
      usedCurrent += amt;
    }
    const carryExpired = today > carryDeadline;
    result = {
      year: yr, rate, estimated: r.estimated,
      carryIn: round2(carryIn), carryUsed: round2(usedCarry), carryFromKasse: restOverride,
      carryRemaining: round2(carryExpired ? 0 : carryLeft),
      carryLost: round2(carryExpired ? carryLeft : 0),
      carryDeadline,
      yearTotal: round2(yearTotal), accruedSoFar: round2(accruedSoFar), usedCurrent: round2(usedCurrent),
      availableNow: round2((carryExpired ? 0 : carryLeft) + accruedSoFar - usedCurrent),
      overspent: usedCurrent > yearTotal,
    };
    carryIn = Math.max(0, yearTotal - usedCurrent);
  }
  // Was vom laufenden Jahr übrig bleibt, verfällt am 30.06. des Folgejahres
  const nextRules = rulesForYear(rules, t.y + 1);
  result.yearLeftover = round2(Math.max(0, result.yearTotal - result.usedCurrent));
  result.yearLeftoverDeadline = ymd(t.y + 1, ...nextRules.entlastungsbetragUebertragBis.split("-").map(Number));
  return result;
}

// ---------- Gemeinsamer Jahresbetrag Verhinderungs- & Kurzzeitpflege (ab PG 2) ----------
export function entlastungsbudget(person, entries, today, rules) {
  if (person.pflegegrad < 2) return null;
  const t = parseDate(today);
  const r = rulesForYear(rules, t.y);
  const pg = String(person.pflegegrad);
  const own = entriesFor(entries, person.id, "entlastungsbudget");
  const thisYear = own.filter((e) => inYear(e, t.y));
  const total = r.entlastungsbudgetJahr[pg] || 0;
  const used = sum(thisYear);
  const relCap = r.verhinderungspflegeAngehoerigeJahr[pg] || 0;
  const relUsed = sum(thisYear.filter((e) => e.angehoerig));
  const prevOpen = own.filter((e) => inYear(e, t.y - 1) && !e.eingereicht);
  return {
    year: t.y, estimated: r.estimated, total, used,
    remaining: round2(Math.max(0, total - used)), overspent: used > total,
    relCap, relUsed, relRemaining: round2(Math.max(0, Math.min(relCap - relUsed, total - used))), relOverspent: relUsed > relCap,
    deadline: ymd(t.y, 12, 31),
    prevYearOpen: sum(prevOpen), prevYearOpenCount: prevOpen.length,
    prevYearDeadline: ymd(t.y - 1 + r.belegFristFolgejahre, 12, 31),
    openThisYear: sum(thisYear.filter((e) => !e.eingereicht)),
  };
}

// ---------- Pflegehilfsmittel (monatlich, kein Übertrag) ----------
export function pflegehilfsmittel(person, entries, today, rules) {
  const t = parseDate(today);
  const r = rulesForYear(rules, t.y);
  if (person.pflegebox) return { monthly: r.pflegehilfsmittelMonat, usedThisMonth: r.pflegehilfsmittelMonat, box: true, remaining: 0, deadline: lastDayOfMonth(t.y, t.m) };
  const used = sum(entriesFor(entries, person.id, "pflegehilfsmittel").filter((e) => { const p = parseDate(e.date); return p.y === t.y && p.m === t.m; }));
  return { monthly: r.pflegehilfsmittelMonat, usedThisMonth: used, box: false, remaining: round2(Math.max(0, r.pflegehilfsmittelMonat - used)), deadline: lastDayOfMonth(t.y, t.m) };
}

// ---------- Pflicht-Beratungsbesuch bei Pflegegeld ----------
export function beratung(person, today, rules) {
  const r = rulesForYear(rules, parseDate(today).y);
  if (!person.bezugPflegegeld || !r.beratung.pflichtPflegegrade.includes(person.pflegegrad)) return null;
  const quartal = person.beratungQuartal && (r.beratung.optionalQuartalPflegegrade || []).includes(person.pflegegrad);
  const interval = quartal ? 3 : r.beratung.intervallMonate;
  const due = person.letzteBeratung ? addMonths(person.letzteBeratung, interval) : today;
  return { interval, due, last: person.letzteBeratung || null, overdue: due <= today && !!person.letzteBeratung, neverDone: !person.letzteBeratung };
}

// ---------- Fristen ----------
export function deadlines(person, entries, today, rules) {
  const list = [];
  const add = (date, title, text, amount = null, kind = "frist") => list.push({ date, title, text, amount, kind, daysLeft: daysBetween(today, date) });
  const e = entlastung(person, entries, today, rules);
  const t = parseDate(today);
  if (e.carryRemaining > 0)
    add(e.carryDeadline, `Entlastungsbetrag ${t.y - 1} läuft ab`, "Das Geld aus dem Vorjahr verfällt an diesem Tag. Nutzen Sie bis dahin Hilfe im Alltag und reichen Sie die Rechnung ein.", e.carryRemaining, "verfall");
  if (e.yearLeftover > 0)
    add(e.yearLeftoverDeadline, `Entlastungsbetrag ${t.y} spätestens nutzen`, "Was in diesem Jahr übrig bleibt, kann noch bis zu diesem Tag genutzt werden. Danach verfällt es.", e.yearLeftover, "verfall");
  const b = entlastungsbudget(person, entries, today, rules);
  if (b) {
    if (b.remaining > 0)
      add(b.deadline, "Geld für Verhinderungs- und Kurzzeitpflege verfällt", "Dieses Geld gilt nur bis zum Jahresende und wird nicht ins nächste Jahr übertragen.", b.remaining, "verfall");
    if (b.prevYearOpen > 0)
      add(b.prevYearDeadline, `Rechnungen aus ${t.y - 1} einreichen`, `${b.prevYearOpenCount} Rechnung(en) noch nicht bei der Pflegekasse eingereicht. Später als zu diesem Tag zahlt die Kasse nicht mehr (§ 39 SGB XI).`, b.prevYearOpen, "beleg");
  }
  const h = pflegehilfsmittel(person, entries, today, rules);
  if (!h.box && h.remaining > 0)
    add(h.deadline, "Pflegehilfsmittel diesen Monat noch nicht genutzt", "Das Geld für Handschuhe, Desinfektion und Ähnliches gilt nur in diesem Monat.", h.remaining, "verfall");
  const ber = beratung(person, today, rules);
  if (ber)
    add(ber.due, ber.neverDone ? "Beratungsbesuch eintragen" : "Beratungsbesuch fällig",
      ber.neverDone ? "Wer Pflegegeld bekommt, muss regelmäßig einen Beratungsbesuch nachweisen. Tragen Sie das Datum des letzten Besuchs ein, dann zeigt die App den nächsten Termin."
        : `Der Besuch ist alle ${ber.interval} Monate Pflicht. Ohne Besuch kann die Pflegekasse das Pflegegeld kürzen. Den Termin vereinbaren Sie z. B. mit einem Pflegedienst.`, null, "termin");
  return list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)).map((d) => ({ ...d, level: d.daysLeft < 0 ? "ueberfaellig" : d.daysLeft <= 30 ? "bald" : "ok" }));
}

// ---------- Hinweise aus den Regeln ----------
export function activeNotices(rules, person, today) {
  return (rules.notices || []).filter((n) => (!n.showUntil || today <= n.showUntil) && (!n.pflegegrade || !person || n.pflegegrade.includes(person.pflegegrad)));
}

// ---------- Ansprüche-Übersicht ----------
export function anspruchsListe(person, today, rules) {
  const r = rulesForYear(rules, parseDate(today).y);
  const pg = String(person.pflegegrad);
  const rows = [];
  const push = (label, value, einheit) => { if (value) rows.push({ label, value, einheit }); };
  push("Pflegegeld", r.pflegegeldMonat[pg], "pro Monat");
  push("Pflegesachleistung (Pflegedienst)", r.sachleistungMonat[pg], "pro Monat");
  push("Entlastungsbetrag", r.entlastungsbetragMonat[pg], "pro Monat");
  push("Tages- und Nachtpflege", r.tagespflegeMonat[pg], "pro Monat");
  push("Verhinderungs- und Kurzzeitpflege", r.entlastungsbudgetJahr[pg], "pro Jahr");
  push("Pflegehilfsmittel zum Verbrauch", r.pflegehilfsmittelMonat, "pro Monat");
  push("Wohnumfeldverbesserung", r.wohnumfeldProMassnahme, "pro Maßnahme");
  if (r.sachleistungMonat[pg]) push(`Bis zu ${r.umwandlungProzent} % vom Pflegedienst-Betrag für Alltagshilfe nutzen`, round2(r.sachleistungMonat[pg] * r.umwandlungProzent / 100), "pro Monat, höchstens");
  return { rows, estimated: r.estimated, year: r.year };
}

// ---------- Zusammenfassung ----------
export function summary(person, entries, today, rules) {
  const dl = deadlines(person, entries, today, rules);
  const atRisk90 = round2(dl.filter((d) => d.kind === "verfall" && d.daysLeft >= 0 && d.daysLeft <= 90).reduce((s, d) => s + (d.amount || 0), 0));
  return {
    entlastung: entlastung(person, entries, today, rules),
    entlastungsbudget: entlastungsbudget(person, entries, today, rules),
    pflegehilfsmittel: pflegehilfsmittel(person, entries, today, rules),
    beratung: beratung(person, today, rules),
    deadlines: dl, atRisk90,
  };
}
