import type { ComponentChildren } from 'preact';
import type { RevisionMeta } from '../../shared/models/revision';
import { postToExtension } from '../state/messaging';

export function CommitHeader({
  revision,
  actions,
}: {
  revision: RevisionMeta;
  actions?: ComponentChildren;
}) {
  const isWorkingTree = revision.kind === 'workingTree';
  const shortHash = isWorkingTree ? 'Working Tree' : revision.id.slice(0, 8);
  return (
    <header class="ftm-card-header">
      <div class="ftm-card-line1">
        <button
          type="button"
          class={`ftm-hash ${isWorkingTree ? 'ftm-hash-wt' : ''}`}
          title={isWorkingTree ? 'Uncommitted changes' : `Copy full hash ${revision.id}`}
          onClick={() =>
            isWorkingTree
              ? undefined
              : postToExtension({ type: 'copy', payload: { text: revision.id, what: 'hash' } })
          }
        >
          <span
            class={`codicon ${isWorkingTree ? 'codicon-edit' : 'codicon-git-commit'}`}
            aria-hidden="true"
          />
          {shortHash}
        </button>
        <span class="ftm-subject" title={revision.body || revision.subject}>
          {revision.subject}
        </span>
        <Badges revision={revision} />
        <Stats revision={revision} />
        {actions}
      </div>
      <div class="ftm-card-line2">
        <span class="ftm-author" title={revision.author.name}>
          {revision.author.name}
        </span>
        <span class="ftm-dot" aria-hidden="true">
          ·
        </span>
        <time class="ftm-date" dateTime={new Date(revision.authorDate).toISOString()}>
          {formatDate(revision.authorDate)}
        </time>
        {revision.path ? (
          <span class="ftm-path-group">
            <span class="ftm-dot" aria-hidden="true">
              ·
            </span>
            <span class="ftm-path" title={revision.path}>
              {revision.path}
            </span>
          </span>
        ) : null}
      </div>
    </header>
  );
}

function Badges({ revision }: { revision: RevisionMeta }) {
  const badges: { text: string; title: string }[] = [];
  if (revision.isMerge) {
    badges.push({
      text: 'merge · vs first parent',
      title: 'Merge commit; changes shown against its first parent',
    });
  }
  if (revision.changeKind === 'R') {
    badges.push({
      text: `renamed from ${revision.previousPath ?? '?'}`,
      title: 'The file was renamed in this commit',
    });
  }
  if (revision.changeKind === 'C') {
    badges.push({
      text: `copied from ${revision.previousPath ?? '?'}`,
      title: 'Git detected this file as a copy',
    });
  }
  if (revision.changeKind === 'A') {
    badges.push({ text: 'created', title: 'The file was created in this commit' });
  }
  if (revision.changeKind === 'D') {
    badges.push({ text: 'deleted', title: 'The file was deleted in this commit' });
  }
  if (badges.length === 0) {
    return null;
  }
  return (
    <span class="ftm-badges">
      {badges.map((b) => (
        <span key={b.text} class="ftm-badge" title={b.title}>
          {b.text}
        </span>
      ))}
    </span>
  );
}

function Stats({ revision }: { revision: RevisionMeta }) {
  const stats = revision.stats;
  if (!stats) {
    return null;
  }
  if (stats.binary) {
    return <span class="ftm-stats ftm-stats-binary">binary</span>;
  }
  return (
    <span
      class="ftm-stats"
      aria-label={`${stats.additions} additions, ${stats.deletions} deletions`}
    >
      <span class="ftm-stat-add">+{stats.additions}</span>{' '}
      <span class="ftm-stat-del">−{stats.deletions}</span>
    </span>
  );
}

export function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  const now = Date.now();
  const diffDays = Math.floor((now - timestamp) / 86_400_000);
  const time = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (diffDays === 0 && date.getDate() === new Date(now).getDate()) {
    return `Today · ${time}`;
  }
  if (diffDays <= 1 && diffDays >= 0) {
    return `Yesterday · ${time}`;
  }
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  const day = date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
  return `${day} · ${time}`;
}
