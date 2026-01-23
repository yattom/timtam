"use client";

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import MeetingDetailClient from './MeetingDetailClient';

function MeetingDetailContent() {
  const searchParams = useSearchParams();
  const meetingId = searchParams.get('id');

  if (!meetingId) {
    return <div>Meeting ID is required</div>;
  }

  return <MeetingDetailClient meetingId={meetingId} />;
}

export default function MeetingDetailPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <MeetingDetailContent />
    </Suspense>
  );
}
