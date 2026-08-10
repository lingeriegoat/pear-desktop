import type { HistoryItem, SpotifyQueueConfig } from './index';

const SEL = {
  sidePanel: '#side-panel.side-panel',
  nativeTabs: 'tp-yt-paper-tabs.tab-header-container',
  tabRenderer: 'ytmusic-tab-renderer#tab-renderer',
  queueHeaderSubtitle: 'ytmusic-queue-header-renderer .subtitle',
  // Scoped to the *native* queue only. Recently-played rows are rebuilt
  // using the same `ytmusic-player-queue-item` tag (see buildInteractiveHistoryRow
  // below) so they can reuse YT Music's own rendering/menu logic — but that
  // means a bare `document.querySelectorAll('ytmusic-player-queue-item')`
  // would also pick up our injected history rows. Always query through
  // queueContainer to stay scoped to the real, live queue.
  queueContainer: 'ytmusic-player-queue#queue',
  queueItem: 'ytmusic-player-queue-item',
} as const;

interface RendererContext {
  getConfig: () => Promise<SpotifyQueueConfig>;
  setConfig: (config: Partial<SpotifyQueueConfig>) => void;
}

type Snapshot = Omit<HistoryItem, 'playedAt' | 'id'> & { key: string; raw?: unknown };

function readQueueItem(el: Element): Omit<HistoryItem, 'playedAt' | 'id'> | null {
  const titleEl = el.querySelector<HTMLElement>('.song-title');
  const bylineEl = el.querySelector<HTMLElement>('.byline');
  const durationEl = el.querySelector<HTMLElement>('.duration');
  const imgEl = el.querySelector<HTMLImageElement>('.thumbnail img');

  const title = titleEl?.getAttribute('title') ?? titleEl?.textContent?.trim();
  if (!title) return null;

  return {
    videoId: el.getAttribute('data-video-id') ?? title,
    title,
    artist: bylineEl?.getAttribute('title') ?? bylineEl?.textContent?.trim() ?? 'Unknown artist',
    thumbnail: imgEl?.src ?? '',
    duration: durationEl?.textContent?.trim() ?? '',
  };
}

/**
 * Polymer components in YT Music's web app are bound to a `data` property
 * holding the raw renderer JSON (title/byline navigation endpoints, thumbnail,
 * and the full "..." menu renderer with working actions). This isn't a
 * documented/public API — it can change or disappear on a YT Music update —
 * but capturing it while a track is live lets us later hand the same object
 * to a freshly-created `ytmusic-player-queue-item` and get a fully
 * interactive row for free.
 */
function readRawRenderer(el: Element): unknown | undefined {
  return (el as unknown as { data?: unknown }).data;
}

function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `h_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function getLiveQueueItems(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(`${SEL.queueContainer} ${SEL.queueItem}`));
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  html?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html !== undefined) node.innerHTML = html;
  return node;
}

function rowMarkup(item: Omit<HistoryItem, 'playedAt' | 'id'>): string {
  const thumbHtml = item.thumbnail
    ? `<img class="spq-row-thumb" src="${item.thumbnail}" alt="" width="48" height="48" />`
    : `<div class="spq-row-thumb spq-row-thumb-empty"></div>`;

  return `
    ${thumbHtml}
    <div class="spq-row-info">
      <div class="spq-row-title">${escapeHtml(item.title)}</div>
      <div class="spq-row-artist">${escapeHtml(item.artist)}</div>
    </div>
    <div class="spq-row-duration">${escapeHtml(item.duration)}</div>
  `;
}

function escapeHtml(s: string): string {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

function computeKey(item: Omit<HistoryItem, 'playedAt' | 'id'>): string {
  return `${item.title}::${item.artist}`;
}

export async function mountSpotifyQueue(context: RendererContext): Promise<() => void> {
  const initialConfig = await context.getConfig();
  let history: HistoryItem[] = initialConfig.history ?? [];
  const maxHistory = initialConfig.maxHistory ?? 100;

  let currentSnapshot: Snapshot | null = null;
  let pollTimer: number | null = null;
  let injectedRoot: HTMLElement | null = null;
  let queueObserver: MutationObserver | null = null;
  let observedQueueContainer: Element | null = null;

  // Raw renderer data captured while a track was live, keyed by history
  // entry id. Session-only — never persisted via context.setConfig — since
  // it's large, deeply-nested, and only useful for the lifetime of the
  // currently-running app. Entries fall out of this map once they age out
  // of `history` (see recordHistoryEntry).
  const historyRawById = new Map<string, unknown>();

  let tabsBar: HTMLElement;
  let queueTabBtn: HTMLButtonElement;
  let historyTabBtn: HTMLButtonElement;
  let nowPlayingCard: HTMLElement;
  let nextFromLabel: HTMLElement;
  let historyPane: HTMLElement;
  let historyList: HTMLElement;

  function buildUi(sidePanel: HTMLElement, nativeTabs: HTMLElement, tabRenderer: HTMLElement) {
    nativeTabs.classList.add('spq-hidden');

    injectedRoot = el('div', 'spq-root');

    tabsBar = el('div', 'spq-tabs');
    queueTabBtn = el('button', 'spq-tab spq-tab-active', 'Queue') as HTMLButtonElement;
    historyTabBtn = el('button', 'spq-tab', 'Recently Played') as HTMLButtonElement;
    tabsBar.append(queueTabBtn, historyTabBtn);

    nowPlayingCard = el('div', 'spq-now-playing spq-hidden');
    nextFromLabel = el('div', 'spq-next-from');

    historyPane = el('div', 'spq-history-pane spq-hidden');
    const historyHeader = el('div', 'spq-history-header', 'Recently played');
    historyList = el('div', 'spq-history-list');
    historyPane.append(historyHeader, historyList);

    injectedRoot.append(tabsBar, nowPlayingCard, nextFromLabel);

    sidePanel.insertBefore(injectedRoot, tabRenderer);
    sidePanel.insertBefore(historyPane, tabRenderer.nextSibling);

    queueTabBtn.addEventListener('click', () => showQueueTab());
    historyTabBtn.addEventListener('click', () => showHistoryTab());

    renderHistory();
  }

  function showQueueTab() {
    queueTabBtn.classList.add('spq-tab-active');
    historyTabBtn.classList.remove('spq-tab-active');
    document.querySelector(SEL.tabRenderer)?.classList.remove('spq-hidden');
    historyPane.classList.add('spq-hidden');
    nowPlayingCard.classList.remove('spq-hidden');
    nextFromLabel.classList.remove('spq-hidden');
  }

  function showHistoryTab() {
    historyTabBtn.classList.add('spq-tab-active');
    queueTabBtn.classList.remove('spq-tab-active');
    document.querySelector(SEL.tabRenderer)?.classList.add('spq-hidden');
    historyPane.classList.remove('spq-hidden');
    nowPlayingCard.classList.add('spq-hidden');
    nextFromLabel.classList.add('spq-hidden');
  }

  function buildInteractiveHistoryRow(raw: unknown): HTMLElement {
    // Create a *real* ytmusic-player-queue-item and feed it the renderer
    // data we captured while it was live. YT Music's own component then
    // renders the thumbnail/title/byline/duration and wires up the "..."
    // menu (start radio, go to artist, save to playlist, etc.) exactly as
    // it would in the native queue — we don't have to reimplement any of
    // that ourselves.
    const node = document.createElement(SEL.queueItem);
    node.classList.add('spq-history-row', 'spq-history-row-interactive');
    (node as unknown as { data: unknown }).data = raw;
    return node;
  }

  function renderHistory() {
    historyList.innerHTML = '';
    if (history.length === 0) {
      historyList.append(el('div', 'spq-history-empty', 'Nothing played yet.'));
      return;
    }
    for (const item of history) {
      const raw = historyRawById.get(item.id);
      const row =
        raw !== undefined
          ? buildInteractiveHistoryRow(raw)
          : el('div', 'spq-row spq-history-row', rowMarkup(item));
      historyList.append(row);
    }
  }

  function recordHistoryEntry(snapshot: Snapshot) {
    const id = generateId();
    const entry: HistoryItem = {
      id,
      videoId: snapshot.videoId,
      title: snapshot.title,
      artist: snapshot.artist,
      thumbnail: snapshot.thumbnail,
      duration: snapshot.duration,
      playedAt: Date.now(),
    };
    if (snapshot.raw !== undefined) {
      historyRawById.set(id, snapshot.raw);
    }
    history = [entry, ...history].slice(0, maxHistory);

    // Drop cached raw renderers for entries that just aged out of history.
    const liveIds = new Set(history.map((h) => h.id));
    for (const cachedId of historyRawById.keys()) {
      if (!liveIds.has(cachedId)) historyRawById.delete(cachedId);
    }

    context.setConfig({ history });
    renderHistory();
  }

  function updateNowPlayingCard(snapshot: Snapshot) {
    const playlistSubtitle = document.querySelector<HTMLElement>(SEL.queueHeaderSubtitle);
    const playlistName = playlistSubtitle?.getAttribute('title') ?? playlistSubtitle?.textContent?.trim() ?? '';

    nowPlayingCard.classList.remove('spq-hidden');
    nowPlayingCard.innerHTML = `
      <div class="spq-now-playing-label">Now playing</div>
      <div class="spq-row spq-now-playing-row">${rowMarkup(snapshot)}</div>
    `;

    nextFromLabel.textContent = playlistName ? `Next from: ${playlistName}` : 'Next up';
  }

  // The native queue list is a flat, ordered array of every track in the
  // mix (already played, current, and upcoming) — hide everything at or
  // before the current track's position, leaving only genuinely upcoming
  // tracks visible. Called both from the poll loop and, immediately, from
  // a MutationObserver, since waiting up to a second for the next poll
  // tick to re-apply this after YT Music reshuffles/recycles queue nodes
  // is what caused already-played tracks to flash back into view.
  function applyQueueHiding(liveQueueItems: HTMLElement[]) {
    const selectedEl = liveQueueItems.find((qi) => qi.hasAttribute('selected'));
    if (!selectedEl) {
      // No item is marked [selected] at this exact instant — almost always
      // a brief mid-transition moment while YT Music swaps the current
      // track, not evidence that playback stopped. Leave the existing
      // hide/show state exactly as it is rather than guessing; wiping it
      // here is what caused tracks to occasionally never re-hide at all.
      return;
    }
    const selectedIndex = liveQueueItems.indexOf(selectedEl);
    liveQueueItems.forEach((qi, idx) => {
      qi.classList.toggle('spq-hidden', idx <= selectedIndex);
    });
  }

  function ensureQueueObserver() {
    const queueContainer = document.querySelector<HTMLElement>(SEL.queueContainer);
    if (!queueContainer) return;
    if (queueContainer === observedQueueContainer && queueObserver) return;

    queueObserver?.disconnect();
    observedQueueContainer = queueContainer;
    queueObserver = new MutationObserver(() => {
      applyQueueHiding(getLiveQueueItems());
    });
    queueObserver.observe(queueContainer, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['selected'],
    });
  }

  function clearNowPlaying() {
    nowPlayingCard.classList.add('spq-hidden');
    nextFromLabel.textContent = '';
    getLiveQueueItems().forEach((qi) => qi.classList.remove('spq-hidden'));
  }

  function poll() {
    const sidePanel = document.querySelector<HTMLElement>(SEL.sidePanel);
    const nativeTabs = document.querySelector<HTMLElement>(SEL.nativeTabs);
    const tabRenderer = document.querySelector<HTMLElement>(SEL.tabRenderer);

    if (sidePanel && nativeTabs && tabRenderer && (!injectedRoot || !injectedRoot.isConnected)) {
      buildUi(sidePanel, nativeTabs, tabRenderer);
    }

    if (!injectedRoot) return;

    ensureQueueObserver();

    const liveQueueItems = getLiveQueueItems();
    applyQueueHiding(liveQueueItems);

    const selectedEl = liveQueueItems.find((qi) => qi.hasAttribute('selected'));
    if (!selectedEl) {
      if (liveQueueItems.length === 0) {
        // Genuinely nothing queued/playing — safe to clear.
        clearNowPlaying();
      }
      // Otherwise: items exist but none is [selected] right this instant —
      // a brief mid-transition tick. Skip updating now-playing/history this
      // round; applyQueueHiding above already left the prior state intact,
      // and the next tick (or the observer, immediately) will settle it.
      return;
    }

    const data = readQueueItem(selectedEl);
    if (!data) return;

    const key = computeKey(data);
    // Re-captured every tick (not just on change) so that by the time this
    // track moves into history we have its most recent — and hopefully
    // still-valid — renderer data, in case the underlying DOM node gets
    // recycled by the app right around the moment the track changes.
    const raw = readRawRenderer(selectedEl);

    if (!currentSnapshot || currentSnapshot.key !== key) {
      if (currentSnapshot) {
        recordHistoryEntry(currentSnapshot);
      }
      currentSnapshot = { ...data, key, raw };
    } else {
      currentSnapshot = { ...data, key, raw };
    }

    updateNowPlayingCard(currentSnapshot);
  }

  poll();
  pollTimer = window.setInterval(poll, 1000);

  return function cleanup() {
    if (pollTimer !== null) window.clearInterval(pollTimer);
    queueObserver?.disconnect();
    queueObserver = null;
    observedQueueContainer = null;
    injectedRoot?.remove();
    historyPane?.remove();
    document.querySelector(SEL.nativeTabs)?.classList.remove('spq-hidden');
    getLiveQueueItems().forEach((qi) => qi.classList.remove('spq-hidden'));
    document.querySelector(SEL.tabRenderer)?.classList.remove('spq-hidden');
  };
}
