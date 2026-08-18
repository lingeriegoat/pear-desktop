import type { BlockedArtist } from './index';

export const sortBlockedArtists = (
  artists: BlockedArtist[],
): BlockedArtist[] =>
  [...artists].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
  );
