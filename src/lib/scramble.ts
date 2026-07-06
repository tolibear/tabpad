// privacy-mode text obfuscation: every word becomes deterministic gibberish.
// deterministic (hash of char + position) so re-renders don't flicker, and
// markdown structure (headings, checkboxes, bullets, quotes) is preserved so
// the page still reads as "notes" — just unreadable ones.
const LETTERS = "abcdefghijklmnopqrstuvwxyz";

const LINE_PREFIX = /^(\s*(?:#{1,4}\s+|- \[[ xX]\]\s|-\s|>\s?))/;

export function scrambleText(text: string): string {
  return text.split("\n").map(scrambleLine).join("\n");
}

function scrambleLine(line: string): string {
  if (/^\s*---\s*$/.test(line)) return line; // divider stays a divider
  const head = LINE_PREFIX.exec(line)?.[1] ?? "";
  const rest = line.slice(head.length);
  let out = head;
  for (let i = 0; i < rest.length; i += 1) {
    out += junkChar(rest[i], i);
  }
  return out;
}

function junkChar(ch: string, position: number): string {
  if (/\s/.test(ch)) return ch;
  const hash = (ch.charCodeAt(0) * 131 + position * 31) % 26;
  if (/[0-9]/.test(ch)) return String((ch.charCodeAt(0) + position) % 10);
  const letter = LETTERS[hash];
  return /\p{Lu}/u.test(ch) ? letter.toUpperCase() : letter;
}
