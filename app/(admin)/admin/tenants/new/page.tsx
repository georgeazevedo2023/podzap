import { redirect } from 'next/navigation';

/**
 * Fallback `/admin/tenants/new` route. The primary create flow is the modal
 * on `/admin/tenants`, but a bookmarked/deep-linked "new" URL should still
 * work — we just bounce to the list page which opens the modal immediately
 * when `?new=1` is present. Keeps the list as the single source of truth
 * for create state.
 */
export default function NewTenantPage() {
  redirect('/admin/tenants?new=1');
}
