import { PageSkeleton } from '@/components/ui/PageSkeleton';

/**
 * Next.js automatically renders this while any `(protected)/**` page JS is
 * compiling (dev) or downloading (prod). Keeps the shell visible and prevents
 * the white-flash that users previously saw between navigations.
 */
export default function Loading() {
  return <PageSkeleton />;
}
