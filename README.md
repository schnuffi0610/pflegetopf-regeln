# Pflegetopf – Regeln

Diese Datei steuert alle Beträge und Fristen in der App **Pflegetopf**. Die App lädt `rules.json` von hier und übernimmt eine neue Version automatisch, aber nur, wenn sie gültig ist und eine höhere `version` hat.

## So wird aktualisiert
1. Jeden Monat prüft ein geplanter Task von Claude offizielle Quellen (BMG, Gesetze im Internet, Bundesgesetzblatt) auf Änderungen.
2. Gibt es Änderungen, öffnet er einen **Pull Request** mit Quellenangaben. Er wird nie direkt eingespielt.
3. Die GitHub-Prüfung ("Regeln prüfen") muss grün sein.
4. **Du** prüfst die Zahlen gegen die verlinkten Quellen und klickst auf *Merge*. Erst dann sehen die Nutzer die neuen Werte.

## Regeln für Änderungen
- Nur Werte aus beschlossenen Gesetzen oder offiziellen Quellen eintragen, nie aus Entwürfen.
- Geplante Änderungen kommen nur als Hinweis in `notices`.
- `version` immer auf das heutige Datum setzen (JJJJ-MM-TT).
- Ein neues Jahr erst mit `"confirmed": true` anlegen, wenn die Beträge feststehen.
- Lokal prüfen: `node validate.mjs`
