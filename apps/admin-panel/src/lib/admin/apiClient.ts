/**
 * Re-export from the canonical admin API client.
 * All admin API calls go through @/lib/api.ts — this file exists for backward compatibility.
 */
export { adminFetch, getAdminApiBaseUrl, type AdminApiResponse } from '@/lib/api';
