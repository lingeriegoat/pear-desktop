import { dialog } from 'electron';
import prompt from 'custom-electron-prompt';

import { t } from '@/i18n';
import promptOptions from '@/providers/prompt-options';

import type { BlocklistPluginConfig } from './index';
import { sortBlockedArtists } from './sort';
import type { MenuTemplate } from '@/menu';
import type { MenuContext } from '@/types/contexts';

export const onMenu = async ({
  getConfig,
  setConfig,
  refresh,
  window,
}: MenuContext<BlocklistPluginConfig>): Promise<MenuTemplate> => {
  const config = await getConfig();

  const template: MenuTemplate = [
    {
      label: t('plugins.blocklist.menu.add.label'),
      async click() {
        const name = await prompt(
          {
            title: t('plugins.blocklist.menu.add.prompt-title'),
            label: t('plugins.blocklist.menu.add.prompt-label'),
            type: 'input',
            value: '',
            width: 400,
            ...promptOptions(),
          },
          window,
        );

        const trimmed = typeof name === 'string' ? name.trim() : '';
        if (!trimmed) return;

        const alreadyBlocked = config.blockedArtists.some(
          (artist) => artist.name.toLowerCase() === trimmed.toLowerCase(),
        );
        if (alreadyBlocked) return;

        setConfig({
          blockedArtists: sortBlockedArtists([
            ...config.blockedArtists,
            { name: trimmed },
          ]),
        });
        await refresh();
      },
    },
    { type: 'separator' },
  ];

  if (config.blockedArtists.length === 0) {
    template.push(
      {
        label: t('plugins.blocklist.menu.no-artists'),
        enabled: false,
      },
      { type: 'separator' },
      {
        label: t('plugins.blocklist.menu.refresh'),
        click() {
          refresh();
        },
      },
    );
    return template;
  }

  for (const artist of config.blockedArtists) {
    template.push({
      label: artist.name,
      submenu: [
        {
          label: t('plugins.blocklist.menu.remove'),
          click() {
            setConfig({
              blockedArtists: config.blockedArtists.filter(
                (it) => it !== artist,
              ),
            });
            refresh();
          },
        },
      ],
    });
  }

  template.push(
    { type: 'separator' },
    {
      label: t('plugins.blocklist.menu.refresh'),
      click() {
        refresh();
      },
    },
    { type: 'separator' },
    {
      label: t('plugins.blocklist.menu.clear'),
      async click() {
        const artistCount = config.blockedArtists.length;
        const { response } = await dialog.showMessageBox(window, {
          type: 'warning',
          buttons: [
            t('plugins.blocklist.menu.clear-confirm.yes'),
            t('plugins.blocklist.menu.clear-confirm.no'),
          ],
          defaultId: 1,
          cancelId: 1,
          title: t('plugins.blocklist.menu.clear-confirm.title'),
          message: t('plugins.blocklist.menu.clear-confirm.message', {
            count: artistCount,
          }),
        });
        if (response !== 0) return;

        setConfig({ blockedArtists: [] });
        refresh();
      },
    },
  );

  return template;
};