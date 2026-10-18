// Prüft rules.json mit derselben Logik wie die App. Aufruf: node validate.mjs
import fs from "node:fs";
import { validateRules, rulesForYear } from "./lib/engine.js";
const rules = JSON.parse(fs.readFileSync(new URL("./rules.json", import.meta.url), "utf8"));
const v = validateRules(rules);
if (!v.ok) { console.error("❌ rules.json ist fehlerhaft:\n- " + v.errors.join("\n- ")); process.exit(1); }
const y = new Date().getFullYear();
for (const yr of [y, y + 1]) {
  const r = rulesForYear(rules, yr);
  console.log(`${yr}: ${r.estimated ? "NICHT bestätigt (Schätzung)" : "bestätigt"} – Entlastungsbetrag PG1 ${r.entlastungsbetragMonat["1"] ?? "entfällt"} €, Pflegegeld PG2 ${r.pflegegeldMonat["2"]} €`);
}
console.log(`✅ rules.json Version ${rules.version} ist gültig`);
