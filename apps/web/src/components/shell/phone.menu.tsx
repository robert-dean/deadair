import { ActionIcon, Menu } from '@mantine/core';
import { IconDotsVertical } from '@tabler/icons-react';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

/**
 * The way out, behind one corner control, and on a phone the machinery too.
 *
 * Logout sat at the foot of the rail. With the rail gone it lives here on every width: it is reached
 * for rarely and on purpose, which is what a menu is for. On a desk the header pins Check-up and
 * Settings itself, so the menu holds only Logout; below `sm` the header has no room for them and the
 * bottom bar carries only the four destinations (`phone.tabs.tsx` says why four), so they are here.
 */
export function PhoneMenu({ onLogout, loggingOut }: { onLogout: () => void; loggingOut?: boolean }) {
    const { t } = useTranslation('shell');
    return (
        <Menu position="bottom-end" withinPortal>
            <Menu.Target>
                <ActionIcon variant="default" size="lg" aria-label={t('phoneMenu.label')}>
                    <IconDotsVertical size={18} stroke={1.8} />
                </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
                {/* Annotated for the reason every `renderRoot` in this console is: Mantine hands
                    back `any`, and spreading an `any` into a `Link` switches off the check that
                    `to` is a route that exists. */}
                <Menu.Item hiddenFrom="sm" renderRoot={(props: object) => <Link to="/checkup" {...props} />}>
                    {t('destination.checkup')}
                </Menu.Item>
                <Menu.Item hiddenFrom="sm" renderRoot={(props: object) => <Link to="/settings" {...props} />}>
                    {t('destination.settings')}
                </Menu.Item>
                <Menu.Divider hiddenFrom="sm" />
                <Menu.Item disabled={loggingOut} onClick={onLogout}>
                    {t('logout')}
                </Menu.Item>
            </Menu.Dropdown>
        </Menu>
    );
}
