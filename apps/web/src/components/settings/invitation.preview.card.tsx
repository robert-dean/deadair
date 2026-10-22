import { useState } from 'react';
import { Alert, Card, Code, Group, SegmentedControl, Stack, Tabs, Text, Title } from '@mantine/core';
import { useTranslation } from 'react-i18next';

import { useInvitationPreview, useSettings } from '../../api/settings.queries';
import { isForbidden } from '../../api/sdk.error';
import { ErrorAlert } from '../shared/error.alert';
import { PageSkeleton } from '../shared/page.skeleton';
import { StatusLamp } from '../shared/status.lamp';

/** The settings the preview is about. Named here rather than imported, as the form names every key it draws. */
const HOST_KEY = 'mail.host';
const SUBJECT_KEY = 'mail.invitation.subject';
const BODY_KEY = 'mail.invitation.body';

type Role = 'listener' | 'admin';

/**
 * The invitation email as the station would send it now, drawn under the Mail form.
 *
 * It shows what is SAVED, as the sign-in check does, and asks again whenever a save changes the
 * wording: a preview of the draft would need the form to hand over every keystroke, and an operator
 * checking their wording saves it anyway. A saved message the station cannot use is said out loud
 * here, because the only other place it shows is the log line written when an invitation goes out
 * in the station's own words instead.
 *
 * The HTML is drawn in a sandboxed frame with scripts off, which is how it is seen in an inbox and
 * keeps the email's own styles off the console. Draws nothing until the mail fields are showing,
 * and nothing for somebody without the operator's role.
 */
export function InvitationPreviewCard() {
    const { t } = useTranslation('settings');
    const settings = useSettings();
    const [role, setRole] = useState<Role>('listener');

    const values = settings.data?.values;
    const host = typeof values?.[HOST_KEY] === 'string' ? values[HOST_KEY].trim() : '';
    const wording = host === '' ? undefined : { subject: String(values?.[SUBJECT_KEY] ?? ''), body: String(values?.[BODY_KEY] ?? '') };
    const preview = useInvitationPreview(role, wording);

    if (wording === undefined) return undefined;
    if (isForbidden(preview.error)) return undefined;

    return (
        <Card padding="lg">
            <Stack gap="md">
                <Group justify="space-between" align="flex-start">
                    <Stack gap="xxs" maw={480}>
                        <Title order={2} size="h4">
                            {t('invitationPreview.title')}
                        </Title>
                        <Text size="sm" c="dimmed">
                            {t('invitationPreview.intro')}
                        </Text>
                    </Stack>
                    <SegmentedControl
                        size="xs"
                        value={role}
                        onChange={value => setRole(value as Role)}
                        data={[
                            { value: 'listener', label: t('invitationPreview.role.listener') },
                            { value: 'admin', label: t('invitationPreview.role.admin') },
                        ]}
                        aria-label={t('invitationPreview.role.label')}
                    />
                </Group>

                {preview.isPending ? <PageSkeleton variant="rows" count={3} /> : undefined}
                {preview.error ? (
                    <ErrorAlert title={t('invitationPreview.failed.title')} error={preview.error} fallback={t('invitationPreview.failed.fallback')} />
                ) : undefined}

                {preview.data ? (
                    <Stack gap="sm">
                        {preview.data.problem ? (
                            <Alert color="yellow" variant="light" title={t('invitationPreview.unusable')}>
                                {preview.data.problem}
                            </Alert>
                        ) : undefined}
                        <StatusLamp
                            tone={preview.data.ownWording ? 'ok' : 'off'}
                            label={preview.data.ownWording ? t('invitationPreview.wording.yours') : t('invitationPreview.wording.station')}
                        />
                        <Text size="sm">
                            <Text span c="dimmed">
                                {t('invitationPreview.subject')}{' '}
                            </Text>
                            {preview.data.subject}
                        </Text>
                        <Tabs defaultValue="email">
                            <Tabs.List>
                                <Tabs.Tab value="email">{t('invitationPreview.tab.email')}</Tabs.Tab>
                                <Tabs.Tab value="text">{t('invitationPreview.tab.text')}</Tabs.Tab>
                            </Tabs.List>
                            <Tabs.Panel value="email" pt="sm">
                                <iframe
                                    title={t('invitationPreview.frameTitle')}
                                    sandbox=""
                                    srcDoc={preview.data.html}
                                    style={{ width: '100%', height: 560, border: 0, borderRadius: 'var(--mantine-radius-sm)', display: 'block' }}
                                />
                            </Tabs.Panel>
                            <Tabs.Panel value="text" pt="sm">
                                <Code block style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                                    {preview.data.text}
                                </Code>
                            </Tabs.Panel>
                        </Tabs>
                    </Stack>
                ) : undefined}
            </Stack>
        </Card>
    );
}
