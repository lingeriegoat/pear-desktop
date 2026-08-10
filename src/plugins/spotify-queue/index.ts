import style from './style.css?inline';

import { createPlugin } from '@/utils';

export interface HistoryItem {
  id: string;
  videoId: string;
  title: string;
  artist: string;
  thumbnail: string;
  duration: string;
  playedAt: number;
}

export interface SpotifyQueueConfig {
  enabled: boolean;
  maxHistory: number;
  history: HistoryItem[];
}

let cleanupFn: (() => void) | undefined;

export default createPlugin({
  name: () => 'Spotify-style Queue',
  description: () =>
    'Replaces the Up Next panel with a Spotify-style Queue / Recently Played view.',
  restartNeeded: true,
  config: {
    enabled: false,
    maxHistory: 100,
    history: [] as HistoryItem[],
  } as SpotifyQueueConfig,
  stylesheets: [style],

  renderer: {
    async start(context) {
      const { mountSpotifyQueue } = await import('./spotify-queue');
      cleanupFn = await mountSpotifyQueue(context);
    },
    stop() {
      cleanupFn?.();
      cleanupFn = undefined;
    },
  },
});
