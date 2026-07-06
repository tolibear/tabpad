import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { DayRow } from "../db/db";
import { dateKey, daysBetween } from "../lib/dates";
import { DaySection } from "./DaySection";
import { buildTimelineWindow, requiredFutureCount, requiredPastCount, type TimelineEntry } from "./jump";

export interface JumpTarget {
  date: Date;
  id: number;
}

const INITIAL_FUTURE = 7;
const INITIAL_PAST = 21;
const EDITABLE_RANGE = 3;

interface TimelineProps {
  today: Date;
  dayTexts: Record<string, string>;
  dayMargins: Record<string, string>;
  contentDays: DayRow[];
  jumpTarget: JumpTarget | null;
  showMargins: boolean;
  layoutMode: string;
  onDayTextChange: (key: string, value: string) => void;
  onDayMarginChange: (key: string, value: string) => void;
  onDayBlur: (key: string) => void;
  onDayMarginBlur: (key: string) => void;
  onDayFocusChange: (key: string, focused: boolean) => void;
  onDayMarginFocusChange: (key: string, focused: boolean) => void;
  onTopDateChange?: (key: string) => void;
}

export const Timeline = memo(function Timeline({
  today,
  dayTexts,
  dayMargins,
  contentDays,
  jumpTarget,
  showMargins,
  layoutMode,
  onDayTextChange,
  onDayMarginChange,
  onDayBlur,
  onDayMarginBlur,
  onDayFocusChange,
  onDayMarginFocusChange,
  onTopDateChange,
}: TimelineProps) {
  const [futureCount, setFutureCount] = useState(INITIAL_FUTURE);
  const [pastCount, setPastCount] = useState(INITIAL_PAST);
  const [activatedKeys, setActivatedKeys] = useState<Set<string>>(() => new Set());
  const [jumpTick, setJumpTick] = useState(0);
  const scrollerRef = useRef<HTMLElement | null>(null);
  const topSentinelRef = useRef<HTMLDivElement | null>(null);
  const bottomSentinelRef = useRef<HTMLDivElement | null>(null);
  const sectionRefs = useRef(new Map<string, HTMLElement>());
  const initialAligned = useRef(false);
  const alignedTodayKey = useRef<string | null>(null);
  const pendingJumpKey = useRef<string | null>(null);
  const handledJumpId = useRef<number | null>(null);
  const jumpScrollActive = useRef(false);
  const highlightedNode = useRef<HTMLElement | null>(null);
  const highlightTimer = useRef(0);
  const lastTopKey = useRef<string | null>(null);

  // keep entry object identity stable across window extensions so memoized
  // day rows don't all re-render on every prepend
  const entryCache = useRef(new Map<string, TimelineEntry>());
  // distance from the bottom of the scroll content, captured just before a
  // top prepend — used to restore the visual position manually, since browser
  // scroll anchoring is absent on Safari and disabled at scrollTop 0
  const pendingTopExtension = useRef<number | null>(null);

  // midnight rollover prepends a new day section; when the alignment effect
  // is going to skip its today re-align (cursor parked in an editor), the
  // prepend would visibly shift the text being typed. snapshot here — during
  // render, before the DOM changes — so the restore effect can compensate.
  const renderedTodayKey = useRef(dateKey(today));
  if (renderedTodayKey.current !== dateKey(today)) {
    renderedTodayKey.current = dateKey(today);
    const scroller = scrollerRef.current;
    if (scroller && initialAligned.current && document.activeElement?.closest(".cm-editor")) {
      pendingTopExtension.current = scroller.scrollHeight - scroller.scrollTop;
    }
  }

  const entries = useMemo(() => {
    const built = buildTimelineWindow({ today, futureCount, pastCount, contentDays });
    return built.map((entry) => {
      const cached = entryCache.current.get(entry.key);
      // compare source by value — listContentDays returns fresh objects every
      // call, so identity comparison would defeat the row memoization entirely
      if (
        cached &&
        cached.kind === entry.kind &&
        cached.source?.main === entry.source?.main &&
        cached.source?.margin === entry.source?.margin
      ) {
        return cached;
      }
      entryCache.current.set(entry.key, entry);
      return entry;
    });
  }, [contentDays, futureCount, pastCount, today]);

  const extendFuture = useCallback(() => {
    // extending the top re-anchors the scroll position, which would abort an
    // in-flight smooth jump scroll — defer until the jump settles
    if (jumpScrollActive.current) return;
    const scroller = scrollerRef.current;
    if (scroller) pendingTopExtension.current = scroller.scrollHeight - scroller.scrollTop;
    setFutureCount((count) => count + 21);
  }, []);

  // restore the pre-prepend position before paint so the reader's view
  // doesn't jump by the height of the new sections (top extensions and
  // rollover prepends both land here; the ref is null otherwise)
  useLayoutEffect(() => {
    const fromBottom = pendingTopExtension.current;
    if (fromBottom === null) return;
    pendingTopExtension.current = null;
    const scroller = scrollerRef.current;
    if (scroller) scroller.scrollTop = scroller.scrollHeight - fromBottom;
  });

  useEffect(() => {
    const top = topSentinelRef.current;
    const scroller = scrollerRef.current;
    if (!top || !scroller) return undefined;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting || !initialAligned.current) return;
        extendFuture();
      },
      // each 21-day batch adds more height than this margin, so the observer
      // fires once per approach instead of back-to-back
      { root: scroller, rootMargin: "2500px 0px", threshold: 0 },
    );

    observer.observe(top);
    return () => observer.disconnect();
  }, [extendFuture]);

  useEffect(() => {
    const bottom = bottomSentinelRef.current;
    const scroller = scrollerRef.current;
    if (!bottom || !scroller) return undefined;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setPastCount((count) => count + 14);
        }
      },
      { root: scroller, rootMargin: "800px 0px", threshold: 0 },
    );

    observer.observe(bottom);
    return () => observer.disconnect();
  }, [pastCount]);

  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    const key = dateKey(today);
    if (!scroller || alignedTodayKey.current === key) return;

    const todayNode = sectionRefs.current.get(key);
    if (!todayNode) return;

    // midnight rollover with a cursor parked in some note: don't yank the
    // view (and the user's next keystrokes) away to the new today section
    if (initialAligned.current && document.activeElement?.closest(".cm-editor")) {
      alignedTodayKey.current = key;
      return;
    }

    // editors mount in layout effects, so heights are final here — align once,
    // synchronously, before the first paint
    scroller.scrollTop = sectionTop(scroller, todayNode);
    initialAligned.current = true;
    alignedTodayKey.current = key;

    // one late correction for font-loading shifts, but never fight the user:
    // skip it if they have scrolled in the meantime
    const intended = scroller.scrollTop;
    const timer = window.setTimeout(() => {
      const node = sectionRefs.current.get(key);
      if (node && Math.abs(scroller.scrollTop - intended) < 4) {
        scroller.scrollTop = sectionTop(scroller, node);
      }
    }, 150);

    return () => window.clearTimeout(timer);
  }, [entries, today]);

  const reportTopDate = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller || entries.length === 0) return;

    const scrollerTop = scroller.getBoundingClientRect().top + 24;
    // entries are in DOM order (future → past): binary-search the first
    // section whose bottom reaches the viewport top instead of measuring all
    let lo = 0;
    let hi = entries.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      const node = sectionRefs.current.get(entries[mid].key);
      if (node && node.getBoundingClientRect().bottom < scrollerTop) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    const nextKey = entries[lo].key;

    if (nextKey !== lastTopKey.current) {
      lastTopKey.current = nextKey;
      onTopDateChange?.(nextKey);
    }
  }, [entries, onTopDateChange]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return undefined;

    reportTopDate();
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        reportTopDate();
      });
    };

    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      scroller.removeEventListener("scroll", onScroll);
    };
  }, [entries, reportTopDate]);

  useEffect(() => {
    if (!jumpTarget || handledJumpId.current === jumpTarget.id) return;
    handledJumpId.current = jumpTarget.id;

    const key = dateKey(jumpTarget.date);
    const neededFuture = requiredFutureCount(today, jumpTarget.date);
    const neededPast = requiredPastCount(today, jumpTarget.date);
    setFutureCount((count) => Math.max(count, neededFuture + 7));
    setPastCount((count) => Math.max(count, neededPast + 7));
    pendingJumpKey.current = key;
    setJumpTick((tick) => tick + 1);
  }, [jumpTarget, today]);

  useLayoutEffect(() => {
    const key = pendingJumpKey.current;
    const scroller = scrollerRef.current;
    if (!key || !scroller) return;

    const node = sectionRefs.current.get(key);
    if (!node) return;

    jumpScrollActive.current = true;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    scroller.scrollTo({ top: sectionTop(scroller, node), behavior: reduceMotion ? "auto" : "smooth" });
    node.querySelector<HTMLElement>(".cm-content")?.focus({ preventScroll: true });
    // only one day highlighted at a time — clear the previous jump's highlight
    if (highlightedNode.current && highlightedNode.current !== node) {
      highlightedNode.current.classList.remove("jump-highlight");
    }
    window.clearTimeout(highlightTimer.current);
    highlightedNode.current = node;
    node.classList.add("jump-highlight");
    highlightTimer.current = window.setTimeout(() => {
      node.classList.remove("jump-highlight");
      if (highlightedNode.current === node) highlightedNode.current = null;
    }, 900);
    pendingJumpKey.current = null;

    // release the extend-future guard once the smooth scroll settles
    let settleTimer = 0;
    const settle = () => {
      window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(() => {
        scroller.removeEventListener("scroll", settle);
        jumpScrollActive.current = false;
        // the top observer only fires on intersection transitions; if the jump
        // landed inside its margin while extension was suppressed, extend now
        if (scroller.scrollTop < 2500) {
          extendFuture();
        }
        reportTopDate();
      }, 120);
    };
    scroller.addEventListener("scroll", settle, { passive: true });
    settle();
  }, [entries, extendFuture, jumpTick, reportTopDate]);

  // panel-mode switches change column widths (and thus day heights) — keep the
  // current top day anchored instead of letting the view drift
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    const key = lastTopKey.current;
    if (!scroller || !key || !initialAligned.current) return;
    const node = sectionRefs.current.get(key);
    if (node) {
      scroller.scrollTop = sectionTop(scroller, node);
    }
  }, [layoutMode]);

  const registerSection = useCallback((key: string, node: HTMLElement | null) => {
    if (node) {
      sectionRefs.current.set(key, node);
    } else {
      sectionRefs.current.delete(key);
    }
  }, []);

  const activateDay = useCallback((key: string, part: "main" | "margin" = "main") => {
    setActivatedKeys((current) => {
      if (current.has(key)) return current;
      const next = new Set(current);
      next.add(key);
      return next;
    });
    window.requestAnimationFrame(() => {
      const section = sectionRefs.current.get(key);
      if (!section) return;
      // focus the editor the user actually clicked — margin clicks go straight
      // to the margin, not the day's note
      const container = part === "margin" ? section.querySelector<HTMLElement>(".day-margin") : section.querySelector<HTMLElement>(".day-body");
      const content = (container ?? section).querySelector<HTMLElement>(".cm-content");
      content?.focus({ preventScroll: true });
    });
  }, []);

  return (
    <section className="timeline" aria-label="daily notes" ref={scrollerRef}>
      <div className="timeline-inner">
        <div className="timeline-sentinel" ref={topSentinelRef} aria-hidden="true" />
        {entries.map((entry) => (
          <TimelineDay
            entry={entry}
            key={entry.kind === "today" ? `${entry.key}-today` : entry.key}
            today={today}
            activated={activatedKeys.has(entry.key)}
            value={dayTexts[entry.key] ?? entry.source?.main ?? ""}
            marginValue={dayMargins[entry.key] ?? entry.source?.margin ?? ""}
            showMargin={showMargins}
            registerSection={registerSection}
            onActivate={activateDay}
            onDayTextChange={onDayTextChange}
            onDayMarginChange={onDayMarginChange}
            onDayBlur={onDayBlur}
            onDayMarginBlur={onDayMarginBlur}
            onDayFocusChange={onDayFocusChange}
            onDayMarginFocusChange={onDayMarginFocusChange}
          />
        ))}
        <div className="timeline-sentinel" ref={bottomSentinelRef} aria-hidden="true" />
      </div>
    </section>
  );
});

function sectionTop(scroller: HTMLElement, node: HTMLElement): number {
  return Math.max(0, node.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - 24);
}

interface TimelineDayProps {
  entry: TimelineEntry;
  today: Date;
  activated: boolean;
  value: string;
  marginValue: string;
  showMargin: boolean;
  registerSection: (key: string, node: HTMLElement | null) => void;
  onActivate: (key: string, part: "main" | "margin") => void;
  onDayTextChange: (key: string, value: string) => void;
  onDayMarginChange: (key: string, value: string) => void;
  onDayBlur: (key: string) => void;
  onDayMarginBlur: (key: string) => void;
  onDayFocusChange: (key: string, focused: boolean) => void;
  onDayMarginFocusChange: (key: string, focused: boolean) => void;
}

const TimelineDay = memo(function TimelineDay({
  entry,
  today,
  activated,
  value,
  marginValue,
  showMargin,
  registerSection,
  onActivate,
  onDayTextChange,
  onDayMarginChange,
  onDayBlur,
  onDayMarginBlur,
  onDayFocusChange,
  onDayMarginFocusChange,
}: TimelineDayProps) {
  const isToday = entry.kind === "today";
  const nearToday = Math.abs(daysBetween(today, entry.date)) <= EDITABLE_RANGE;
  const isStatic = !isToday && !nearToday && !activated;

  return (
    <DaySection
      date={entry.date}
      isToday={isToday}
      isStatic={isStatic}
      showMargin={showMargin}
      value={value}
      marginValue={marginValue}
      registerRef={(node) => registerSection(entry.key, node)}
      onActivate={(part) => onActivate(entry.key, part)}
      onValueChange={(next) => onDayTextChange(entry.key, next)}
      onMarginChange={(next) => onDayMarginChange(entry.key, next)}
      onBlur={() => onDayBlur(entry.key)}
      onMarginBlur={() => onDayMarginBlur(entry.key)}
      onFocusChange={(focused) => onDayFocusChange(entry.key, focused)}
      onMarginFocusChange={(focused) => onDayMarginFocusChange(entry.key, focused)}
    />
  );
});

export { buildTimelineWindow, requiredFutureCount, requiredPastCount } from "./jump";
