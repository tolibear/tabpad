import MarkdownIt from "markdown-it";
import { nextTaskMarker } from "../widgets/sources";

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
  const task = /^(\s*)- \[([ xX/])\]\s(.*)$/.exec(line);
  if (task) {
    const state = task[2].toLowerCase();
    const checked = state === "x";
    const inProgress = state === "/";
    const className = inProgress ? "static-task in-progress" : checked ? "static-task checked" : "static-task";
    return (
      <div className={className} style={indentStyle(task[1])}>
        <input
          type="checkbox"
          className={inProgress ? "static-task-progress" : undefined}
          checked={checked}
          onChange={() => onToggle(lineIndex)}
        />
        <span dangerouslySetInnerHTML={{ __html: markdown.renderInline(task[3]) }} />
      </div>
    );
  }

  if (!line.trim()) {
    return <div className="static-empty-line" aria-hidden="true" />;
  }

  const heading = /^(#{1,4})\s+(.*)$/.exec(line);
  if (heading) {
    return (
      <div
        className={`static-line static-heading static-h${heading[1].length}`}
        dangerouslySetInnerHTML={{ __html: markdown.renderInline(heading[2]) }}
      />
    );
  }

  const bullet = /^(\s*)-\s(.*)$/.exec(line);
  if (bullet) {
    return (
      <div className="static-line static-bullet" style={indentStyle(bullet[1])}>
        <span className="static-bullet-dot" aria-hidden="true">
          •
        </span>
        <span dangerouslySetInnerHTML={{ __html: markdown.renderInline(bullet[2]) }} />
      </div>
    );
  }

  const quote = /^>\s?(.*)$/.exec(line);
  if (quote) {
    return <div className="static-line static-quote" dangerouslySetInnerHTML={{ __html: markdown.renderInline(quote[1]) }} />;
  }

  if (/^\s*---\s*$/.test(line)) {
    return <div className="static-rule" role="separator" />;
  }

  return <div className="static-line" dangerouslySetInnerHTML={{ __html: markdown.renderInline(line) }} />;
}

function indentStyle(indent: string): { paddingLeft?: string } {
  return indent ? { paddingLeft: `${indent.length * 9}px` } : {};
}

export function toggleTaskLine(source: string, lineIndex: number): string {
  const lines = source.split(/\r?\n/);
  const line = lines[lineIndex];
  if (!line) return source;

  lines[lineIndex] = line.replace(/^(\s*)- (\[[ xX/]\])/, (_full, indent: string, marker: string) => `${indent}- ${nextTaskMarker(marker.toLowerCase())}`);
  return lines.join("\n");
}
