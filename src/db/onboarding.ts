import { addDays, dateKey } from "../lib/dates";
import { db, type DayRow } from "./db";

// first-run onboarding: seed a tiny story across yesterday/today/tomorrow so
// the timeline demonstrates itself. runs once — the meta flag (set even for
// non-empty databases, e.g. after a legacy migration) makes it permanent.
const ONBOARDED_ID = "onboarded";

const YESTERDAY_NOTE = `- [x] research note-taking apps
- [x] look into tabpad.app
`;

const TODAY_NOTE = `# welcome to tab pad

every new tab is your notepad — one page per day. click anywhere and type.

- [x] install tab pad
- [ ] write your first note (seriously, just click and type)
- [ ] connect a notes folder in settings, so backups (and your AI agent) can read your days
- [ ] you're in focus mode — click the target by the date above to see your timeline
- [ ] try privacy mode — the little lock in the top left scrambles everything
- [ ] pick your color — the ⚙ settings, top left
- [ ] press ⌘K and type "next friday"
`;

const REVIEW_NOTE = `- [ ] enjoying tab pad? leave a review → [chrome web store](https://chromewebstore.google.com/detail/ffbbcmokfaloblceadooccdcmocdfdeo/reviews)
`;

const SCRATCHPAD_NOTE = `this is your scratchpad — for things that don't belong to a day.

markdown works everywhere:
**bold**, *italic*, \`code\`, ~~done~~, [links](https://tabpad.app?ref=app)

- [ ] checkboxes too
`;

// returns true only when the seed actually ran, so the app can open the
// first session in focus mode on the welcome note
export async function seedOnboardingIfFirstRun(today: Date): Promise<boolean> {
  try {
    if (await db.meta.get(ONBOARDED_ID)) return false;

    const [dayCount, panelCount] = await Promise.all([db.days.count(), db.panels.count()]);
    if (dayCount === 0 && panelCount === 0) {
      // seed with an EPOCH edit stamp, not now: if the user later connects a
      // folder that already holds real notes for these dates, the files must
      // win the last-write-wins merge — untouched onboarding filler should
      // lose to everything (a stamp of `now` overwrote real files on disk)
      const SEED_STAMP = 1;
      const day = (date: Date, main: string): DayRow => ({
        date: dateKey(date),
        main,
        margin: "",
        createdAt: SEED_STAMP,
        updatedAt: SEED_STAMP,
        mainUpdatedAt: SEED_STAMP,
        marginUpdatedAt: SEED_STAMP,
      });
      await db.transaction("rw", db.days, db.panels, db.meta, async () => {
        await db.days.bulkPut([
          day(addDays(today, -1), YESTERDAY_NOTE),
          day(today, TODAY_NOTE),
          day(addDays(today, 3), REVIEW_NOTE),
        ]);
        // updatedAt 0 = the explicit "never saved, always yield to the file"
        // marker in the scratchpad sync
        await db.panels.put({ id: "scratchpad", content: SCRATCHPAD_NOTE, updatedAt: 0 });
        await db.meta.put({ id: ONBOARDED_ID, value: Date.now() });
      });
      return true;
    }
    // existing data (legacy migration, import) — never seed, just mark done
    await db.meta.put({ id: ONBOARDED_ID, value: Date.now() });
    return false;
  } catch (error) {
    console.warn("Tab Pad onboarding seed failed", error);
    return false;
  }
}
