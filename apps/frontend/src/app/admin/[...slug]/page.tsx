'use client';

import { useParams } from 'next/navigation';
import { RedirectToNewAdmin } from '../redirect-to-new-admin';

export default function AdminCatchAllPage() {
  const params = useParams();
  const slug = params?.slug;
  const path = Array.isArray(slug) ? slug.join('/') : '';
  return <RedirectToNewAdmin to={path ? `/${path}` : ''} />;
}
