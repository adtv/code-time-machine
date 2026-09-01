import type { RevisionMeta } from '../../shared/models/revision';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Humanised duration with a single unit ("3 hours", "2 days", "1.5 years"). */
export function formatDuration(ms: number): string {
  const abs = Math.abs(ms);
  const plural = (n: number, unit: string): string => `${n} ${unit}${n === 1 ? '' : 's'}`;
  if (abs < MINUTE) {
    return 'less than a minute';
  }
  if (abs < HOUR) {
    return plural(Math.round(abs / MINUTE), 'minute');
  }
  if (abs < DAY) {
    return plural(Math.round(abs / HOUR), 'hour');
  }
  if (abs < 14 * DAY) {
    return plural(Math.round(abs / DAY), 'day');
  }
  if (abs < 61 * DAY) {
    return plural(Math.round(abs / (7 * DAY)), 'week');
  }
  if (abs < 548 * DAY) {
    return plural(Math.round(abs / (30.44 * DAY)), 'month');
  }
  const years = Math.round((abs / (365.25 * DAY)) * 10) / 10;
  return `${years} year${years === 1 ? '' : 's'}`;
}

export interface GapLabel {
  text: string;
  title: string;
}

/**
 * Time elapsed between a revision and the previous (older) entry of the history — "how long did
 * this version take to appear". Working tree: time since the last commit.
 */
export function gapSincePrevious(
  revision: RevisionMeta,
  previous: RevisionMeta | undefined,
  now = Date.now(),
): GapLabel | undefined {
  if (!previous) {
    return undefined;
  }
  const format = (timestamp: number): string => new Date(timestamp).toLocaleString();
  if (revision.kind === 'workingTree') {
    return {
      text: `${formatDuration(now - previous.authorDate)} since last commit`,
      title: `Last commit: ${format(previous.authorDate)}`,
    };
  }
  const delta = revision.authorDate - previous.authorDate;
  const title = `Previous revision: ${format(previous.authorDate)}\nThis revision: ${format(revision.authorDate)}`;
  if (delta < 0) {
    return {
      text: `authored ${formatDuration(delta)} before previous (rebased or cherry-picked)`,
      title,
    };
  }
  return { text: `${formatDuration(delta)} after previous`, title };
}
