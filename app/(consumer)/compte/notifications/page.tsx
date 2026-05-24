import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { getUserNotificationPreferences } from '@/lib/notifications/preferences';
import { SectionSkeleton } from '../_components/ContentSkeletons';
import { NotificationsClient } from './NotificationsClient';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Coquille synchrone (post-garde) : le shell /compte reste fixe pendant le
// fetch des préférences, streamé via <Suspense>.
export default async function NotificationsPage() {
  const session = await getSessionUser();
  if (!session) redirect('/connexion');

  return (
    <Suspense fallback={<SectionSkeleton rows={3} />}>
      <NotificationsContent userId={session.id} />
    </Suspense>
  );
}

async function NotificationsContent({ userId }: { userId: string }) {
  const prefs = await getUserNotificationPreferences(userId);

  return <NotificationsClient initialPrefs={prefs} />;
}
