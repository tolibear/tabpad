// Generates demo-data.json — a Tab Pad export with ~30 days of believable
// notes around today, for screenshots/videos. Run: node scripts/make-demo-data.mjs
import { writeFileSync } from "node:fs";

const key = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};
const day = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return key(d);
};

// offset from today → { main, margin }
const notes = {
  [-24]: {
    main: `# quarterly planning kickoff
- [x] block focus time for the roadmap doc
- [x] pull last quarter's numbers
- [ ] draft three candidate themes

> "plans are worthless, but planning is everything"

random: the coffee place on 5th has oat milk cold brew now. dangerous.`,
    margin: `Q3 themes so far:
- speed
- fewer, better features`,
  },
  [-22]: {
    main: `ran 5k before work — 27:41, new best

**meeting notes / infra sync**
- migration is ~80% done
- postgres upgrade slated for the 19th
- *ask sam about the staging env*

- [x] send invoice #204
- [ ] renew domain`,
    margin: `27:41 (!!)
prev best 28:15`,
  },
  [-19]: {
    main: `# ideas parking lot
- a tiny cli that turns screenshots into diagrams
- "focus mode" for the browser — one tab, one hour
- weekly review template with auto-carryover

reading: *the shape of design* — ch. 3 on improvisation is great`,
    margin: ``,
  },
  [-17]: {
    main: `dentist 9:30

- [x] groceries: salmon, lemons, arborio rice
- [x] pick up dry cleaning
- [ ] call the landlord about the radiator

dinner turned out great — risotto needs the full 25 minutes, no shortcuts. write this down so future me stops trying.`,
    margin: `risotto ratio:
1 cup rice : 4 cups stock`,
  },
  [-14]: {
    main: `# design review — onboarding flow
strong reactions to the new empty state. keep the illustration, cut the tooltip tour.

- [x] ship copy changes
- [x] a/b test the shorter form
- [ ] follow up with priya on drop-off metrics

---

evening: taught mom how to video call. patience level: heroic.`,
    margin: `drop-off is at step 3,
not step 2 — recheck`,
  },
  [-12]: {
    main: `slow day. read in the park for two hours.

> the best thinking happens when you're not trying

- [ ] museum tickets for the 20th`,
    margin: ``,
  },
  [-10]: {
    main: `**travel planning — lisbon**
- [x] flights booked (out the 12th, back the 19th)
- [x] airbnb in alfama
- [ ] restaurant list from marta
- [ ] travel insurance

pack light this time. *actually* light.`,
    margin: `flight: TP 212
7:40am — ugh`,
  },
  [-8]: {
    main: `# retro notes
what went well:
- shipped the editor rewrite two days early
- zero regressions reported

what didn't:
- too many meetings on tuesday
- code review queue backed up again

action: **no-meeting wednesdays**, starting next week`,
    margin: `bring up review
rotation next 1:1`,
  },
  [-6]: {
    main: `- [x] morning pages
- [x] gym — pull day
- [x] fix the flaky test in ci
- [ ] write the changelog

the flaky test was a timezone bug. it's always a timezone bug.`,
    margin: `TZ bug count
this year: 4`,
  },
  [-5]: {
    main: `dinner with alex & jordan — the new thai place

they're moving to portland in september. happy for them, sad for us. start planning a proper sendoff.

- [ ] sendoff ideas doc`,
    margin: ``,
  },
  [-3]: {
    main: `# launch prep
- [x] store listing copy
- [x] screenshots (5)
- [x] privacy policy live
- [ ] submit for review
- [ ] hn post draft

keeping scope tight. v1.1 wishlist goes in the scratchpad, not the roadmap.`,
    margin: `review usually
takes 2-3 days`,
  },
  [-2]: {
    main: `quiet saturday.

farmers market haul: peaches, sourdough, way too many tomatoes. sauce project tomorrow.

*started rewatching the wire.*`,
    margin: ``,
  },
  [-1]: {
    main: `sauce day — 4 hours, 6 jars. kitchen looks like a crime scene, worth it.

- [x] meal prep for the week
- [x] call grandpa
- [ ] laundry (moved to monday, obviously)`,
    margin: `jar count: 6
give 2 to neighbors`,
  },
  [0]: {
    main: `# today
- [x] morning run
- [ ] finish the launch checklist
- [ ] review pr #42
- [ ] book haircut

**focus:** one thing at a time. the list isn't the work.

idea from the run — what if the weekly review auto-collected every unchecked task from the past 7 days?`,
    margin: `energy: high
coffee: 2 (limit!)`,
  },
  [1]: {
    main: `- [ ] no-meeting wednesday — deep work on the sync engine
- [ ] lunch with dee, 12:30
- [ ] draft v1.1 notes`,
    margin: ``,
  },
  [3]: {
    main: `**flight to lisbon — 7:40am**
- [ ] passport, chargers, kindle
- [ ] check in online
- [ ] water the plants (ask neighbor)`,
    margin: `cab at 5:45`,
  },
  [6]: {
    main: `# lisbon — day 3
planned: tram 28 early, then the tile museum

- [ ] pastéis de belém (non-negotiable)`,
    margin: ``,
  },
  [10]: {
    main: `back home. unpack, reset, grocery run.

- [ ] expense report
- [ ] photos → shared album`,
    margin: ``,
  },
  [14]: {
    main: `quarterly review with the team — bring the Q3 themes doc

- [ ] prep slides (keep it to 10)`,
    margin: `themes: speed,
fewer better features`,
  },
};

const scratchpad = `## v1.1 wishlist
- weekly review view
- carryover unchecked tasks
- quick capture from any page

## books queue
- *piranesi*
- *the design of everyday things* (reread)

## standing reminders
gym tue/thu/sat · water the ficus friday
call grandpa sundays

random string that needs a home:
"make the easy path the right path"`;

const now = Date.now();
const days = Object.entries(notes).map(([offset, note]) => {
  const date = day(Number(offset));
  // realistic edit times: written that day (or recently, for future plans)
  const base = new Date(date + "T18:30:00").getTime();
  const stamp = Math.min(base, now - 60_000);
  return {
    date,
    main: note.main,
    margin: note.margin ?? "",
    createdAt: stamp - 3600_000,
    updatedAt: stamp,
  };
});

days.sort((a, b) => a.date.localeCompare(b.date));

const payload = {
  schemaVersion: 1,
  exportedAt: now,
  days,
  panels: [{ id: "scratchpad", content: scratchpad, updatedAt: now - 120_000 }],
  settings: {
    theme: "system",
    accent: "blue",
    scratchpad: true,
    margins: true,
    weekStartsOn: 0,
    editorSize: "md",
    font: "sans",
    mirrorEnabled: false,
  },
};

writeFileSync(new URL("../demo-data.json", import.meta.url), JSON.stringify(payload, null, 2) + "\n");
console.log(`wrote demo-data.json — ${days.length} days from ${days[0].date} to ${days[days.length - 1].date}`);
