import { t } from '@/i18n';
import { createPlugin } from '@/utils';
import type { MusicPlayer } from '@/types/music-player';
export default createPlugin({
  name: () => t('plugins.fix-startup-volume.name'),
  description: () => t('plugins.fix-startup-volume.description'),
  restartNeeded: true,
  config: {
    enabled: false,
  },
  renderer: {
    onPlayerApiReady(playerApi) {
      const SLIDER_POLL_INTERVAL_MS = 25;
      const MAX_POLL_MS = 10 * 1000;
      const POST_FOUND_DELAY_MS = 50;
      const NUDGE_STEP_MS = 50;
      const NUDGE_AMOUNT = 1;
      const LOG_PREFIX = '[fix-startup-volume]';

      const VOLUME_SLIDER_SELECTOR = '#volume-slider';

      const dispatchArrowKey = (
        el: HTMLElement,
        key: 'ArrowLeft' | 'ArrowRight',
      ) => {
        const eventInit: KeyboardEventInit = {
          key,
          code: key,
          bubbles: true,
          cancelable: true,
          composed: true,
        };
        el.dispatchEvent(new KeyboardEvent('keydown', eventInit));
        el.dispatchEvent(new KeyboardEvent('keyup', eventInit));
      };

      console.log(LOG_PREFIX, 'onPlayerApiReady fired, polling for slider element');

      const nudgeVolumeToApplyFix = (
        playerApi: MusicPlayer,
        slider: HTMLElement,
      ) => {
        try {
          const currentVolume = playerApi.getVolume();
          const upFirst = currentVolume <= NUDGE_AMOUNT;
          const firstKey: 'ArrowLeft' | 'ArrowRight' = upFirst
            ? 'ArrowRight'
            : 'ArrowLeft';
          const secondKey: 'ArrowLeft' | 'ArrowRight' = upFirst
            ? 'ArrowLeft'
            : 'ArrowRight';

          console.log(
            LOG_PREFIX,
            `dispatching ${firstKey} then ${secondKey}`,
            slider,
          );

          slider.focus();
          dispatchArrowKey(slider, firstKey);

          setTimeout(() => {
            dispatchArrowKey(slider, secondKey);
            console.log(LOG_PREFIX, 'nudge complete via DOM key events');
          }, NUDGE_STEP_MS);
        } catch (err) {
          console.error(LOG_PREFIX, 'nudge threw an error', err);
        }
      };

      const trySlider = (): HTMLElement | null =>
        document.querySelector<HTMLElement>(VOLUME_SLIDER_SELECTOR);

      const onSliderFound = (slider: HTMLElement) => {
        console.log(
          LOG_PREFIX,
          `slider found, nudging in ${POST_FOUND_DELAY_MS}ms`,
        );
        setTimeout(
          () => nudgeVolumeToApplyFix(playerApi, slider),
          POST_FOUND_DELAY_MS,
        );
      };

      const immediateSlider = trySlider();
      if (immediateSlider) {
        onSliderFound(immediateSlider);
      } else {
        let elapsedPollMs = 0;
        const pollForSlider = setInterval(() => {
          elapsedPollMs += SLIDER_POLL_INTERVAL_MS;
          const slider = trySlider();
          if (slider) {
            clearInterval(pollForSlider);
            onSliderFound(slider);
            return;
          }
          if (elapsedPollMs >= MAX_POLL_MS) {
            clearInterval(pollForSlider);
            console.warn(
              LOG_PREFIX,
              `slider never appeared after ${MAX_POLL_MS}ms, giving up`,
            );
          }
        }, SLIDER_POLL_INTERVAL_MS);
      }
    },
  },
});