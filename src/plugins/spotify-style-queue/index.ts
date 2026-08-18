import { createPlugin } from '@/utils';

import style from './style.css?inline';

type SpotifyStyleQueueConfig = {
  enabled: boolean;
  // How many previously-played tracks to keep rendered in "Recently played".
  // The native queue panel keeps every played track above the current one,
  // so this just caps how many of those we bother to render.
  maxRecentlyPlayed: number;
  // Horizontal position of the queue panel within the available space.
  queueAlign: 'left' | 'center' | 'right';
};

type QueueTrack = {
  el: HTMLElement;
  title: string;
  artist: string;
  thumbnail: string;
  duration: string;
  isCurrent: boolean;
};

const SELECTORS = {
  sidePanel: '#side-panel',
  nativeTabs: '#side-panel > tp-yt-paper-tabs.tab-header-container',
  tabRenderer: 'ytmusic-tab-renderer#tab-renderer',
  queueHeader: 'ytmusic-queue-header-renderer',
  queueEl: 'ytmusic-player-queue#queue',
  queueContents: 'ytmusic-player-queue#queue #contents',
} as const;

function waitForElement<T extends Element>(
  selector: string,
  root: ParentNode = document,
): Promise<T> {
  const existing = root.querySelector<T>(selector);
  if (existing) return Promise.resolve(existing);

  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      const found = root.querySelector<T>(selector);
      if (found) {
        observer.disconnect();
        resolve(found);
      }
    });
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  });
}

function textOf(el: Element | null | undefined): string {
  if (!el) return '';
  return el.getAttribute('title')?.trim() || el.textContent?.trim() || '';
}

// The native queue item elements are Polymer-style components: the
// underlying API data (including real thumbnail URLs) is bound onto the
// element as a plain JS property, independent of whatever gets rendered or
// lazy-loaded visually. Reading it directly sidesteps the whole rendering
// pipeline instead of fighting it.
function extractThumbnailUrl(el: HTMLElement): string {
  const candidates: unknown[] = [
    (el as any).data,
    (el as any).__data?.data,
    (el as any).__data,
  ];

  for (const data of candidates) {
    const thumbnails =
      (data as any)?.thumbnail?.thumbnails ||
      (data as any)?.thumbnail?.musicThumbnailRenderer?.thumbnail
        ?.thumbnails;
    if (Array.isArray(thumbnails) && thumbnails.length) {
      const best = thumbnails.reduce((a: any, b: any) =>
        (b?.width || 0) > (a?.width || 0) ? b : a,
      );
      if (best?.url) return best.url as string;
    }
  }

  // Fall back to whatever the <img> already resolved to, in case it did
  // load through some other means.
  const img = el.querySelector<HTMLImageElement>(
    'yt-img-shadow.thumbnail img#img',
  );
  if (img?.src && !img.src.startsWith('data:')) return img.src;

  return '';
}

function collectTracks(
  contents: HTMLElement,
  thumbnailCache: Map<string, string>,
): QueueTrack[] {
  const items = Array.from(
    contents.querySelectorAll<HTMLElement>('ytmusic-player-queue-item'),
  ).filter((el) => {
    // Skip the hidden "counterpart" item automix sometimes keeps around,
    // and anything nested inside a currently-hidden wrapper.
    if (el.closest('[hidden]')) return false;
    return true;
  });

  return items.map((el) => {
    const title = textOf(el.querySelector('.song-title'));
    const artist = textOf(el.querySelector('.byline'));
    const key = `${title}\u241F${artist}`;

    let thumbnail = thumbnailCache.get(key) || '';
    if (!thumbnail) {
      thumbnail = extractThumbnailUrl(el);
      if (thumbnail) thumbnailCache.set(key, thumbnail);
    }

    return {
      el,
      title,
      artist,
      duration: textOf(el.querySelector('.duration')),
      thumbnail,
      isCurrent: el.hasAttribute('selected'),
    };
  });
}

const MENU_BUTTON_HTML = `
    <button type="button" class="ssq-row-menu" aria-label="Action menu">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
        <circle cx="12" cy="5" r="2"></circle>
        <circle cx="12" cy="12" r="2"></circle>
        <circle cx="12" cy="19" r="2"></circle>
      </svg>
    </button>
`;

function rowHTML(track: QueueTrack, variant: 'current' | 'row'): string {
  const art = track.thumbnail
    ? `<img src="${track.thumbnail}" alt="" />`
    : `<div class="ssq-art-fallback"></div>`;

  if (variant === 'current') {
    return `
      <div class="ssq-now-playing-art">${art}</div>
      <div class="ssq-now-playing-info">
        <div class="ssq-now-playing-title">${escapeHTML(track.title)}</div>
        <div class="ssq-now-playing-artist">${escapeHTML(track.artist)}</div>
      </div>
      <div class="ssq-row-duration">${escapeHTML(track.duration)}</div>
      ${MENU_BUTTON_HTML}
    `;
  }

  return `
    <div class="ssq-row-art">${art}</div>
    <div class="ssq-row-info">
      <div class="ssq-row-title">${escapeHTML(track.title)}</div>
      <div class="ssq-row-artist">${escapeHTML(track.artist)}</div>
    </div>
    <div class="ssq-row-duration">${escapeHTML(track.duration)}</div>
    ${MENU_BUTTON_HTML}
  `;
}

function escapeHTML(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

export default createPlugin({
  name: () => 'Spotify-Style Queue',
  description: () =>
    'Restyles the queue panel into a Spotify-like "Queue" (now playing + up next) and "Recently played" view. Played tracks move out of the way instead of sitting in a static list.',
  restartNeeded: false,
  config: {
    enabled: false,
    maxRecentlyPlayed: 50,
    queueAlign: 'left',
  } satisfies SpotifyStyleQueueConfig as SpotifyStyleQueueConfig,
  stylesheets: [style],

  menu: async ({ getConfig, setConfig }) => {
    const config = await getConfig();
    const options = [10, 25, 50, 100, 0];
    const aligns: Array<{ value: SpotifyStyleQueueConfig['queueAlign']; label: string }> = [
      { value: 'left', label: 'Left' },
      { value: 'center', label: 'Center' },
      { value: 'right', label: 'Right' },
    ];

    return [
      {
        label: 'Recently played limit',
        submenu: options.map((value) => ({
          label: value === 0 ? 'Unlimited' : `${value} tracks`,
          type: 'radio',
          checked: config.maxRecentlyPlayed === value,
          click() {
            setConfig({ maxRecentlyPlayed: value });
          },
        })),
      },
      {
        label: 'Queue position',
        submenu: aligns.map(({ value, label }) => ({
          label,
          type: 'radio',
          checked: (config.queueAlign || 'left') === value,
          click() {
            setConfig({ queueAlign: value });
          },
        })),
      },
    ];
  },

  renderer: {
    activeTab: 'queue' as 'queue' | 'recent',
    config: null as SpotifyStyleQueueConfig | null,
    sidePanel: null as HTMLElement | null,
    panelEl: null as HTMLElement | null,
    tabbarEl: null as HTMLElement | null,
    setConfig: null as ((c: Partial<SpotifyStyleQueueConfig>) => void) | null,
    rectObserver: null as ResizeObserver | null,
    rectPollInterval: null as number | null,
    queueListEl: null as HTMLElement | null,
    recentListEl: null as HTMLElement | null,
    nowPlayingLabelEl: null as HTMLElement | null,
    nowPlayingEl: null as HTMLElement | null,
    nextLabelEl: null as HTMLElement | null,
    recentEmptyEl: null as HTMLElement | null,
    pollInterval: null as number | null,
    pendingScrollReset: false,
    videoChangeDebounce: null as number | null,
    thumbnailCache: new Map<string, string>(),
    renderQueued: false,
    onVideoDataChange: null as ((e: Event) => void) | null,
    openMenuTrackKey: null as string | null,

    async start(context) {
      this.config = await context.getConfig();
      this.setConfig = context.setConfig;

      context.onConfigChange?.((newConfig: SpotifyStyleQueueConfig) => {
        this.config = newConfig;
        this.syncPanelRect();
        this.scheduleRender();
      });

      await this.injectUI();
    },

    async injectUI() {
      const sidePanel = await waitForElement<HTMLElement>(
        SELECTORS.sidePanel,
      );
      const nativeTabs = await waitForElement<HTMLElement>(
        SELECTORS.nativeTabs,
        sidePanel,
      );
      const tabRenderer = await waitForElement<HTMLElement>(
        SELECTORS.tabRenderer,
        sidePanel,
      );
      await waitForElement<HTMLElement>(SELECTORS.queueContents, sidePanel);

      this.sidePanel = sidePanel;
      sidePanel.classList.add('ssq-active');

      // Custom tab bar, replacing "Up next / Lyrics / Comments / Related".
      const bar = document.createElement('div');
      bar.className = 'ssq-tabbar';
      bar.innerHTML = `
        <button type="button" class="ssq-tab is-active" data-tab="queue">Queue</button>
        <button type="button" class="ssq-tab" data-tab="recent">Recently played</button>
        <button type="button" class="ssq-align-toggle" aria-label="Change queue position" title="Change queue position">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <line x1="4" y1="6" x2="20" y2="6"></line>
            <line x1="4" y1="12" x2="14" y2="12"></line>
            <line x1="4" y1="18" x2="20" y2="18"></line>
          </svg>
        </button>
      `;
      bar.addEventListener('click', (e) => {
        const alignBtn = (e.target as HTMLElement).closest<HTMLElement>(
          '.ssq-align-toggle',
        );
        if (alignBtn) {
          this.cycleQueueAlign();
          return;
        }
        const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(
          '.ssq-tab',
        );
        if (!btn) return;
        this.setActiveTab(btn.dataset.tab === 'recent' ? 'recent' : 'queue');
      });
      nativeTabs.insertAdjacentElement('beforebegin', bar);
      this.tabbarEl = bar;

      // Custom panel, sitting in front of (not replacing) the native content.
      const panel = document.createElement('div');
      panel.className = 'ssq-panel';
      panel.innerHTML = `
        <div class="ssq-view ssq-view-queue is-active">
          <div class="ssq-now-playing-label">Now Playing</div>
          <div class="ssq-now-playing"></div>
          <div class="ssq-section-label">Next Up</div>
          <div class="ssq-list ssq-queue-list"></div>
        </div>
        <div class="ssq-view ssq-view-recent">
          <div class="ssq-empty">Songs you've played will show up here.</div>
          <div class="ssq-list ssq-recent-list"></div>
        </div>
      `;
      // Appended to document.body (not nested inside #tab-renderer) so
      // that position:fixed is guaranteed to anchor to the real viewport —
      // #tab-renderer is very likely a CSS-transformed ancestor (used for
      // its own show/hide or GPU-layer animation), and a transformed
      // ancestor becomes the containing block for any position:fixed
      // descendant instead of the viewport, which is what was producing
      // the offset/clipped rendering. Its on-screen rect is kept synced to
      // #tab-renderer's own bounding box in JS (see syncPanelRect).
      document.body.appendChild(panel);
      this.panelEl = panel;

      // Sync the panel's rect immediately on any size change (panel open/
      // close, window resize). ResizeObserver alone isn't enough — it only
      // fires when the *observed element's own* size changes, but closing
      // the side panel very likely works by animating/hiding an ancestor
      // rather than #tab-renderer itself changing size, which
      // ResizeObserver would never see. A fast dedicated interval (cheap —
      // it's just a rect read and a few conditional style writes) catches
      // that regardless of the exact mechanism, instead of waiting up to a
      // full second for the next heavy render poll to happen to catch it.
      this.rectObserver = new ResizeObserver(() => this.syncPanelRect());
      this.rectObserver.observe(tabRenderer);
      this.syncPanelRect();
      this.rectPollInterval = window.setInterval(
        () => this.syncPanelRect(),
        100,
      );

      this.nowPlayingLabelEl = panel.querySelector('.ssq-now-playing-label');
      this.nowPlayingEl = panel.querySelector('.ssq-now-playing');
      this.nextLabelEl = panel.querySelector('.ssq-section-label');
      this.queueListEl = panel.querySelector('.ssq-queue-list');
      this.recentListEl = panel.querySelector('.ssq-recent-list');
      this.recentEmptyEl = panel.querySelector('.ssq-empty');

      // Delegate row clicks back to the real (invisible) native queue items
      // so YTM's own playback/navigation logic keeps doing the actual work.
      panel.addEventListener('click', (e) => {
        const menuBtn = (e.target as HTMLElement).closest<HTMLElement>(
          '.ssq-row-menu',
        );
        const menuRow = menuBtn?.closest<HTMLElement>('[data-ref]');
        const menuIndex = menuRow ? Number(menuRow.dataset.ref) : -1;
        const menuTrack =
          menuIndex >= 0 ? this.lastTracks?.[menuIndex] : undefined;
        const menuTrackKey = menuTrack
          ? `${menuTrack.title}\u241F${menuTrack.artist}`
          : null;

        // Check the real dropdown's own `.opened` state directly rather
        // than mirroring it ourselves — it's the single source of truth
        // and can't drift out of sync the way our own tracked flag did.
        const isOpen = !!this.findOpenDropdown();

        if (isOpen) {
          // Identify "same button clicked again" by the track it belongs
          // to, not by DOM node identity — the row list gets fully
          // re-rendered (including on a 1s poll), which recreates every
          // button element, so a stored node reference goes stale almost
          // immediately even though the same track's button is on screen.
          const wasSameTrack =
            !!menuTrackKey && menuTrackKey === this.openMenuTrackKey;
          this.closeOpenMenu();
          // Any click inside the panel dismisses an already-open menu
          // first, rather than also performing that click's own action —
          // except clicking a *different* row's menu button, which opens
          // that one instead of just closing.
          if (!wasSameTrack && menuBtn) this.openMenu(menuBtn, menuTrackKey);
          return;
        }

        if (menuBtn) {
          this.openMenu(menuBtn, menuTrackKey);
          return;
        }

        const row = (e.target as HTMLElement).closest<HTMLElement>(
          '[data-ref]',
        );
        // The now-playing row is already playing — clicking it (outside the
        // menu, handled above) should do nothing.
        if (!row || row.dataset.current === 'true') return;
        const index = Number(row.dataset.ref);
        const target = this.lastTracks?.[index]?.el;
        // The outer queue-item wrapper isn't itself the clickable region —
        // the play icon overlay on the thumbnail (visible on hover in the
        // native UI) is what actually triggers jumping to that track.
        const playTrigger = target?.querySelector<HTMLElement>(
          'ytmusic-play-button-renderer#play-button, ytmusic-play-button-renderer',
        );
        (playTrigger ?? target)?.click();
      });

      // Right-click anywhere on a row opens its menu, same as clicking the
      // 3-dot button — reuses all the same toggle/open logic by dispatching
      // a real click at that button, which bubbles into the handler above.
      panel.addEventListener('contextmenu', (e) => {
        const row = (e.target as HTMLElement).closest<HTMLElement>(
          '[data-ref]',
        );
        if (!row) return;
        e.preventDefault();
        row.querySelector<HTMLElement>('.ssq-row-menu')?.click();
      });

      this.scheduleRender();

      // Two triggers cover everything we need without watching specific DOM
      // nodes that could get replaced out from under us: `videodatachange`
      // fires on every real track change (including skips), and the poll
      // is a cheap, unconditional safety net that also picks up autoplay
      // appending new tracks to the end of the queue.
      this.onVideoDataChange = () => {
        // Debounce rather than react to every individual event — rapid
        // track skips fire several videodatachange events within a couple
        // hundred milliseconds of each other, and reacting to each one
        // independently was causing several full, expensive list rewrites
        // (each ~30KB+ of markup for a long queue) to land back-to-back,
        // which is what was actually showing as a blank flash: not missing
        // data, but the render pipeline getting hit multiple times before
        // the browser could finish painting the previous one. Resetting
        // the timer on each new event collapses a burst into one render
        // that fires once things settle.
        if (this.videoChangeDebounce !== null) {
          window.clearTimeout(this.videoChangeDebounce);
        }
        this.videoChangeDebounce = window.setTimeout(() => {
          this.videoChangeDebounce = null;
          this.pendingScrollReset = true;
          this.scheduleRender();
        }, 150);
      };
      document.addEventListener('videodatachange', this.onVideoDataChange);
      this.pollInterval = window.setInterval(() => this.scheduleRender(), 1000);
    },

    // The real popup is a `<tp-yt-iron-dropdown>` element living inside
    // `<ytmusic-popup-container>` at the app root, confirmed via a live
    // HTML capture — it exposes a standard Polymer `.opened` property/
    // `.close()` method we can drive directly. This component is likely
    // reused for other dropdowns across the app too, so there can be more
    // than one on the page — search all of them for whichever is actually
    // open rather than assuming the first one found is ours.
    findOpenDropdown(): any {
      const all = Array.from(
        document.querySelectorAll<HTMLElement>('tp-yt-iron-dropdown'),
      );
      const viaProperty = all.find((d: any) => d.opened);
      if (viaProperty) return viaProperty;
      // Fallback: confirmed via live inspection that it only gets
      // position:fixed with a real on-screen size while genuinely open, in
      // case `.opened` isn't the right signal for some reason.
      return (
        all.find((d) => {
          const r = d.getBoundingClientRect();
          return (
            getComputedStyle(d).position === 'fixed' &&
            r.width > 20 &&
            r.height > 20
          );
        }) || null
      );
    },

    openMenu(menuBtn: HTMLElement, trackKey: string | null) {
      const row = menuBtn.closest<HTMLElement>('[data-ref]');
      const index = row ? Number(row.dataset.ref) : -1;
      const target = this.lastTracks?.[index]?.el;

      // The native queue's own "scroll the current track into view"
      // behavior is still active on the real (invisible) list underneath —
      // we decoupled our own panel's visuals from it, but the native
      // elements themselves are still physically being scrolled, which
      // throws off their real on-screen position the further into a long
      // queue you go. Reset it before reading/using that position.
      const nativeQueueEl = this.sidePanel?.querySelector<HTMLElement>(
        'ytmusic-player-queue#queue',
      );
      if (nativeQueueEl) nativeQueueEl.scrollTop = 0;

      // The whole native list is content-visibility:hidden by default for
      // performance (see style.css) — temporarily promote just this one
      // item back to normal so it has a real on-screen position, then
      // revert once that's had a moment to read.
      target?.style.setProperty('content-visibility', 'visible', 'important');
      // Force a synchronous layout flush so both of the above are actually
      // applied before anything below reads layout/dispatches a click,
      // rather than relying on it landing before the next paint.
      void target?.offsetHeight;

      const nativeMenuBtn = target?.querySelector<HTMLElement>(
        'ytmusic-menu-renderer button',
      );
      nativeMenuBtn?.click();
      this.openMenuTrackKey = trackKey;

      // Don't trust native positioning for where the popup ends up — it
      // depends on that fragile native scroll state (see above), which
      // was sending it further and further off-screen for tracks deeper
      // in the list even with the reset above as a safety net. Anchor it
      // to our own button's real, always-accurate position instead, and
      // flip left/up (and clamp within the viewport) when the default
      // right/down placement would run off-screen — a big menu opened
      // from a button near the right or bottom edge needs to open the
      // other direction to stay fully visible.
      const anchorRect = menuBtn.getBoundingClientRect();
      const margin = 8;
      const gap = 4;
      const reposition = () => {
        const dropdown = this.findOpenDropdown();
        if (!dropdown) return;
        // The native component applies its own "fit to available space"
        // max-height (with its own internal scrollbar) based on wherever
        // it originally thought it would be positioned, before we override
        // that below. Force it off so the menu always renders at its true
        // full content height — otherwise our own measurement here would
        // read that already-squashed height and wrongly conclude there's
        // enough room to open downward when there isn't.
        dropdown.style.setProperty('max-height', 'none', 'important');
        dropdown.style.setProperty('overflow', 'visible', 'important');
        // In case the height cap actually lives on an inner wrapper rather
        // than the dropdown element itself.
        Array.from(dropdown.querySelectorAll('*') as HTMLElement[]).forEach(
          (el: HTMLElement) => {
            if (
              getComputedStyle(el).maxHeight !== 'none' ||
              getComputedStyle(el).overflowY === 'auto' ||
              getComputedStyle(el).overflowY === 'scroll'
            ) {
              el.style.setProperty('max-height', 'none', 'important');
              el.style.setProperty('overflow', 'visible', 'important');
            }
          },
        );
        const menuRect = dropdown.getBoundingClientRect();
        const menuW = menuRect.width || dropdown.offsetWidth || 240;
        const menuH = menuRect.height || dropdown.offsetHeight || 300;
        const vw = window.innerWidth;
        const vh = window.innerHeight;

        // Horizontally: the button always sits at the right end of a row,
        // so opening rightward from it — even when that technically fits
        // within the viewport — starts by covering the button (and the
        // track-time text next to it) itself. Default to opening to the
        // *left* of the button instead, with a small gap; only fall back
        // to opening rightward (starting at the button's own left edge)
        // if there's genuinely no room to the left.
        let left =
          anchorRect.left - menuW - gap < margin
            ? anchorRect.left
            : anchorRect.left - menuW - gap;
        let top =
          anchorRect.bottom + menuH > vh - margin
            ? anchorRect.top - menuH
            : anchorRect.bottom;

        // Clamp within the viewport either way, in case the menu is
        // larger than the available space even after flipping.
        left = Math.max(margin, Math.min(left, vw - menuW - margin));
        top = Math.max(margin, Math.min(top, vh - menuH - margin));

        dropdown.style.setProperty('left', `${Math.round(left)}px`, 'important');
        dropdown.style.setProperty('top', `${Math.round(top)}px`, 'important');
        // Polymer overlay components like this one often position
        // themselves with a CSS transform for performance, layered on top
        // of left/top — left unchecked, that can shift the menu right back
        // toward wherever the (wrong, far-off) native anchor point put it,
        // undoing the override above. Neutralize it explicitly.
        dropdown.style.setProperty('transform', 'none', 'important');
      };
      requestAnimationFrame(() => {
        reposition();
        // And again a frame later, in case native code repositions it
        // itself right after opening.
        requestAnimationFrame(reposition);
      });

      setTimeout(() => {
        target?.style.removeProperty('content-visibility');
      }, 300);
    },

    closeOpenMenu() {
      const dropdown = this.findOpenDropdown();
      if (dropdown) {
        if (typeof dropdown.close === 'function') {
          dropdown.close();
        } else {
          dropdown.opened = false;
        }
      }
      this.openMenuTrackKey = null;
    },

    cycleQueueAlign() {
      const order: Array<SpotifyStyleQueueConfig['queueAlign']> = [
        'left',
        'center',
        'right',
      ];
      const current = this.config?.queueAlign || 'left';
      const next = order[(order.indexOf(current) + 1) % order.length];
      if (this.config) this.config = { ...this.config, queueAlign: next };
      this.setConfig?.({ queueAlign: next });
      this.syncPanelRect();
    },

    setActiveTab(tab: 'queue' | 'recent') {
      this.activeTab = tab;
      this.sidePanel
        ?.querySelectorAll('.ssq-tab')
        .forEach((el) =>
          el.classList.toggle(
            'is-active',
            (el as HTMLElement).dataset.tab === tab,
          ),
        );
      // .ssq-view elements live inside .ssq-panel, which is appended to
      // document.body (not nested inside sidePanel) — querying from
      // sidePanel here was silently finding nothing, so the tab button
      // itself switched but the visible content underneath never did.
      this.panelEl?.querySelectorAll('.ssq-view').forEach((el) => {
        el.classList.toggle(
          'is-active',
          el.classList.contains(`ssq-view-${tab}`),
        );
      });
    },

    scheduleRender() {
      if (this.renderQueued) return;
      this.renderQueued = true;
      requestAnimationFrame(() => {
        this.renderQueued = false;
        this.render();
      });
    },

    lastTracks: [] as QueueTrack[],
    lastNowPlayingHTML: '',
    queueRowMap: new Map<HTMLElement, HTMLElement>(),
    recentRowMap: new Map<HTMLElement, HTMLElement>(),
    rowContentCache: new WeakMap<HTMLElement, string>(),

    // Recreating DOM nodes the mouse happens to be over makes the browser
    // briefly drop :hover on them until it re-evaluates (visible flicker),
    // and rebuilding ~100 rows (each with an <img>) from scratch on every
    // single track change gets expensive enough on its own, once a long
    // session's queue has grown large, to visibly jank for a moment even
    // for a single, unhurried track change. Neither is about *how often*
    // we render — it's that a full rebuild is wasteful when a normal
    // update only really changes one or two rows. This keeps one DOM
    // element per native track (keyed by its native element, stable across
    // renders) and reuses it — including its already-loaded image — for as
    // long as that track stays in the same list, only touching content
    // that actually changed and only adding/removing/reordering the
    // specific rows that need it.
    reconcileRows(
      container: HTMLElement,
      rows: QueueTrack[],
      fullTracks: QueueTrack[],
      rowMap: Map<HTMLElement, HTMLElement>,
    ) {
      const used = new Set<HTMLElement>();
      let prev: HTMLElement | null = null;

      for (const track of rows) {
        used.add(track.el);
        let row = rowMap.get(track.el);
        if (!row) {
          row = document.createElement('div');
          row.className = 'ssq-row';
          rowMap.set(track.el, row);
        }

        const content = rowHTML(track, 'row');
        if (this.rowContentCache.get(row) !== content) {
          row.innerHTML = content;
          this.rowContentCache.set(row, content);
        }

        const ref = String(fullTracks.indexOf(track));
        if (row.dataset.ref !== ref) row.dataset.ref = ref;

        const desiredNext: ChildNode | null = prev
          ? prev.nextSibling
          : container.firstChild;
        if (desiredNext !== row) container.insertBefore(row, desiredNext);
        prev = row;
      }

      for (const [nativeEl, row] of rowMap) {
        if (!used.has(nativeEl)) {
          row.remove();
          rowMap.delete(nativeEl);
          this.rowContentCache.delete(row);
        }
      }
    },

    setHTMLIfChanged(
      field: 'lastNowPlayingHTML',
      el: HTMLElement,
      html: string,
    ) {
      if (this[field] === html) return;
      this[field] = html;
      el.innerHTML = html;
    },

    // Keeps the fixed-position panel's on-screen rect matched to
    // #tab-renderer's own bounding box. That box doesn't move due to
    // #tab-renderer's *own* internal scrolling (only an ancestor's would
    // move it), so this is stable and safe to recompute every render.
    // Width is capped and the panel positioned left/center/right within
    // that available space per queueAlign. The tab bar (a normal, non-fixed
    // element) is kept in sync with the same left offset/width via margin
    // so it visually lines up with the panel regardless of alignment.
    syncPanelRect() {
      const tabRenderer = this.sidePanel?.querySelector<HTMLElement>(
        'ytmusic-tab-renderer#tab-renderer',
      );
      if (!tabRenderer || !this.panelEl) return;
      const r = tabRenderer.getBoundingClientRect();
      const maxWidth = 750;
      const panelWidth = Math.min(maxWidth, r.width);
      const align = this.config?.queueAlign || 'left';
      const leftOffset =
        align === 'right'
          ? r.left + (r.width - panelWidth)
          : align === 'center'
            ? r.left + (r.width - panelWidth) / 2
            : r.left;

      const top = `${Math.round(r.top)}px`;
      const left = `${Math.round(leftOffset)}px`;
      const width = `${Math.round(panelWidth)}px`;
      const height = `${Math.round(r.height)}px`;
      const style = this.panelEl.style;
      if (style.top !== top) style.top = top;
      if (style.left !== left) style.left = left;
      if (style.width !== width) style.width = width;
      if (style.height !== height) style.height = height;

      if (this.tabbarEl) {
        const marginLeft = `${Math.round(leftOffset - r.left)}px`;
        const tabbarWidth = `${Math.round(panelWidth)}px`;
        const tstyle = this.tabbarEl.style;
        if (tstyle.marginLeft !== marginLeft) tstyle.marginLeft = marginLeft;
        if (tstyle.width !== tabbarWidth) tstyle.width = tabbarWidth;
      }
    },

    render() {
      try {
        this.renderInner();
      } catch (err) {
        // A bad track's markup should never permanently freeze the whole
        // panel on stale data — log it and let the next scheduled render
        // (poll/observer/videodatachange) retry.
        console.error('[Spotify-Style Queue] render failed', err);
      }
    },

    renderInner() {
      this.syncPanelRect();

      const contents = this.sidePanel?.querySelector<HTMLElement>(
        'ytmusic-player-queue#queue #contents',
      );
      if (
        !contents ||
        !this.queueListEl ||
        !this.recentListEl ||
        !this.nowPlayingEl
      )
        return;

      const tracks = collectTracks(contents, this.thumbnailCache);

      // A genuinely empty queue essentially never happens in normal use —
      // a zero-length read right after having a healthy list is much more
      // likely a transient snapshot caught mid-update (e.g. the native app
      // briefly rebuilding its internal list when autoplay appends a batch
      // of new tracks, rather than simply appending to it). The poll timer
      // fires on a fixed schedule regardless of what the native DOM is
      // doing, so it can land in that exact narrow window. Skip acting on
      // it rather than blanking everything out — the next render (poll/
      // videodatachange, ~1s away at most) will pick up the settled state.
      if (tracks.length === 0 && this.lastTracks.length > 0) {
        return;
      }
      this.lastTracks = tracks;

      let currentIndex = tracks.findIndex((t) => t.isCurrent);
      if (currentIndex === -1) currentIndex = tracks.length ? 0 : -1;

      const played = currentIndex > 0 ? tracks.slice(0, currentIndex) : [];
      const current = currentIndex >= 0 ? tracks[currentIndex] : null;
      const upcoming =
        currentIndex >= 0 ? tracks.slice(currentIndex + 1) : tracks;

      // "Now playing"
      if (current) {
        this.setHTMLIfChanged(
          'lastNowPlayingHTML',
          this.nowPlayingEl,
          rowHTML(current, 'current'),
        );
        this.nowPlayingEl.classList.remove('is-empty');
        this.nowPlayingEl.dataset.ref = String(tracks.indexOf(current));
        this.nowPlayingEl.dataset.current = 'true';
        if (this.nowPlayingLabelEl)
          this.nowPlayingLabelEl.style.display = '';
      } else {
        this.setHTMLIfChanged('lastNowPlayingHTML', this.nowPlayingEl, '');
        this.nowPlayingEl.classList.add('is-empty');
        delete this.nowPlayingEl.dataset.ref;
        delete this.nowPlayingEl.dataset.current;
        if (this.nowPlayingLabelEl)
          this.nowPlayingLabelEl.style.display = 'none';
      }

      // "Next up" list — indices are relative to the full `tracks` array so
      // clicks can look the source element back up in lastTracks.
      this.reconcileRows(
        this.queueListEl,
        upcoming,
        tracks,
        this.queueRowMap,
      );

      if (this.nextLabelEl) {
        // Leave the playlist/mix name exactly as YTM has it — only our own
        // label text ("Next From") is Title Case.
        const sourceName = textOf(
          document.querySelector('ytmusic-queue-header-renderer .subtitle'),
        );
        this.nextLabelEl.textContent = sourceName
          ? `Next From: ${sourceName}`
          : 'Next Up';
        this.nextLabelEl.style.display = upcoming.length ? '' : 'none';
      }

      // "Recently played" — most recently played first.
      const cap = this.config?.maxRecentlyPlayed || 0;
      let recent = [...played].reverse();
      if (cap > 0) recent = recent.slice(0, cap);

      this.reconcileRows(
        this.recentListEl,
        recent,
        tracks,
        this.recentRowMap,
      );

      if (this.recentEmptyEl) {
        this.recentEmptyEl.style.display = recent.length ? 'none' : '';
      }

      if (this.pendingScrollReset) {
        this.pendingScrollReset = false;
        if (this.panelEl) this.panelEl.scrollTop = 0;
        this.sidePanel
          ?.querySelector<HTMLElement>('ytmusic-tab-renderer#tab-renderer')
          ?.scrollTo(0, 0);
      }
    },

    stop() {
      if (this.pollInterval !== null) {
        window.clearInterval(this.pollInterval);
        this.pollInterval = null;
      }
      if (this.videoChangeDebounce !== null) {
        window.clearTimeout(this.videoChangeDebounce);
        this.videoChangeDebounce = null;
      }
      this.rectObserver?.disconnect();
      this.rectObserver = null;
      if (this.rectPollInterval !== null) {
        window.clearInterval(this.rectPollInterval);
        this.rectPollInterval = null;
      }
      this.queueRowMap.clear();
      this.recentRowMap.clear();
      if (this.onVideoDataChange) {
        document.removeEventListener(
          'videodatachange',
          this.onVideoDataChange,
        );
      }
      this.sidePanel?.classList.remove('ssq-active');
      this.sidePanel?.querySelectorAll('.ssq-tabbar').forEach((el) => el.remove());
      // .ssq-panel lives at document.body level now, not inside sidePanel.
      this.panelEl?.remove();
      this.panelEl = null;
    },
  },
});
