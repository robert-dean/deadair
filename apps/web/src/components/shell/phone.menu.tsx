import { ActionIcon, Menu } from '@mantine/core';
import { IconDotsVertical } from '@tabler/icons-react';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

/**
 * The machinery and the way out, on a phone: the three rows of `nav.footer.tsx`, behind one corner
 * control.
 *
 * Below `sm` the rail does not exist, and with it went Check-up, Settings and Logout — the bottom
 * bar deliberately carries only the four destinations (`phone.tabs.tsx` says why four), which left
 * Logout with no phone path at all. This is not the drawer that bar replaced: the drawer was two
 * gestures to reach PRIMARY navigation and covered the page while you chose. This is a
 * dismiss-on-tap menu for the three things an operator reaches for rarely and on purpose, in the
 * corner the header's own comment calls "the way to move around".
 */
export function PhoneMenu({ onLogout, loggingOut }: { onLogout: () => void; loggingOut?: boolean }) {
    const { t } = useTranslation('shell');
    return (
        <Menu position="bottom-end" withinPortal>
            <Menu.Target>
                <ActionIcon variant="default" size="lg" aria-label={t('phoneMenu.label')} hiddenFrom="sm">
                    <IconDotsVertical size={18} stroke={1.8} />
                </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
                {/* Annotated for the reason every `renderRoot` in this console is: Mantine hands
                    back `any`, and spreading an `any` into a `Link` switches off the check that
                    `to` is a route that exists. */}
                <Menu.Item renderRoot={(props: object) => <Link to="/checkup" {...props} />}>{t('destination.checkup')}</Menu.Item>
                <Menu.Item renderRoot={(props: object) => <Link to="/settings" {...props} />}>{t('destination.settings')}</Menu.Item>
                <Menu.Divider />
                <Menu.Item disabled={loggingOut} onClick={onLogout}>
                    {t('logout')}
                </Menu.Item>
            </Menu.Dropdown>
        </Menu>
    );
}
