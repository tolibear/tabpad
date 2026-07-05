import MarkdownIt from "markdown-it";

const markdown = new MarkdownIt({ html: false, linkify: false, breaks: false });

interface StaticDayProps {
  source: string;
  onChange: (next: string) => void;
}

export function StaticDay({ source, onChange }: StaticDayProps) {
  const lines = source.split(/\r?\n/);

  return (
    <div className="static-day">
      {lines.map((line, index) => (
        <StaticLine key={`${index}-${line}`} line={line} lineIndex={index} onToggle={(lineIndex) => onChange(toggleTaskLine(source, lineIndex))} />
      ))}
    </div>
  );
}

interface StaticLineProps {
  line: string;
  lineIndex: number;
  onToggle: (lineIndex: number) => void;
}

function StaticLine({ line, lineIndex, onToggle }: StaticLineProps) {
  const task = /^(\s*)- \[([ xX])\]\s(.*)$/.exec(line);
  if (task) {
    const checked = task[2].toLowerCase() === "x";
    return (
      <div className={checked ? "static-task checked" : "static-task"}>
        <input type="checkbox" checked={checked} onChange={() => onToggle(lineIndex)} />
        <span dangerouslySetInnerHTML={{ __html: markdown.renderInline(task[3]) }} />
      </div>
    );
  }

  if (!line.trim()) {
    return <div className="static-empty-line" aria-hidden="true" />;
  }

  return <div className="static-line" dangerouslySetInnerHTML={{ __html: markdown.renderInline(line) }} />;
}

export function toggleTaskLine(source: string, lineIndex: number): string {
  const lines = source.split(/\r?\n/);
  const line = lines[lineIndex];
  if (!line) return source;

  lines[lineIndex] = /^(\s*)- \[ \]/.test(line) ? line.replace(/^(\s*)- \[ \]/, "$1- [x]") : line.replace(/^(\s*)- \[[xX]\]/, "$1- [ ]");
  return lines.join("\n");
}
