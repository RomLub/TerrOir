import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { getUserNotificationPreferences } from '@/lib/notifications/preferences';
import { NotificationsClient } from './NotificationsClient';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function NotificationsPage() {
  const session = await getSessionUser();
  if (!session) redirect('/connexion');

  const prefs = await getUserNotificationPreferences(session.id);

  return <NotificationsClient initialPrefs={prefs} />;
}
