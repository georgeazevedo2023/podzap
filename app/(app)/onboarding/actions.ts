'use server';

// NOTE: `@/lib/whatsapp/service` is authored in parallel by another agent.
// These server actions will fail type-check / build until that module lands.
// The expected exports are:
//   - `createOrReuseInstance(tenantId: string): Promise<InstanceView>`
//   - `disconnectInstance(tenantId: string, instanceId: string): Promise<void>`
//   - `getCurrentInstance(tenantId: string): Promise<InstanceView | null>`
//   - type `InstanceView`

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';

import { getCurrentUserAndTenant } from '@/lib/tenant';
import {
  createOrReuseInstance,
  disconnectInstance,
} from '@/lib/whatsapp/service';

/**
 * Server action: ensure the current tenant has a (connecting) WhatsApp
 * instance. Called from the "gerar QR code" button on the onboarding page
 * when no instance exists yet.
 *
 * Delegates to the service layer so the same business rules apply as when
 * `POST /api/whatsapp/connect` is called — the API route is a thin wrapper
 * over the same helper.
 *
 * Always redirects back to `/onboarding`; the page then renders the
 * `QrCodePanel` (client) which picks up polling from here.
 */
export async function startConnectAction(): Promise<void> {
  const context = await getCurrentUserAndTenant();
  if (!context) {
    redirect('/login?error=Faça login para continuar');
  }

  await createOrReuseInstance(context.tenant.id);

  // Force the server page to re-fetch `getCurrentInstance` on the next render.
  revalidatePath('/onboarding');
  redirect('/onboarding');
}

/**
 * Server action: disconnect the given instance. Wraps `disconnectInstance`
 * from the service. Used by the `ConnectedPanel` "desconectar" button AND by
 * the "cancelar" flow inside `QrCodePanel` (alternative to calling the API
 * route — both work, action is simpler from server-rendered buttons).
 */
export async function disconnectAction(instanceId: string): Promise<void> {
  const context = await getCurrentUserAndTenant();
  if (!context) {
    redirect('/login?error=Faça login para continuar');
  }

  await disconnectInstance(context.tenant.id, instanceId);

  revalidatePath('/onboarding');
  redirect('/onboarding');
}
