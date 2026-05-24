import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth/session';
import { getUserNotificationPreferences } from '@/lib/notifications/preferences';
import { SectionSkeleton } from '../_components/ContentSkeletons';
import { NotificationsClient } from './NotificationsClient';


// Coquille SYNCHRONE (streaming Suspense) : la page retourne immédiatement le
// <Suspense> + skeleton. La garde session est déplacée DANS le flux
// (NotificationsGate) pour que le shell /compte reste rendu tout de suite (Suspense).
export default function NotificationsPage() {
  return (
    <Suspense fallback={<SectionSkeleton rows={3} />}>
      <NotificationsGate />
    </Suspense>
  );
}

async function NotificationsGate() {
  const session = await getSessionUser();
  if (!session) redirect('/connexion');

  return <NotificationsContent userId={session.id} />;
}

async function NotificationsContent({ userId }: { userId: string }) {
  const prefs = await getUserNotificationPreferences(userId);

  return <NotificationsClient initialPrefs={prefs} />;
}
