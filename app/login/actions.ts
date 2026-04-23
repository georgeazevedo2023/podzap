'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

/**
 * Password-based login (F13).
 *
 * Replaces the previous magic-link (`signInWithOtp`) flow. Tenancy is now
 * admin-managed — a superadmin provisions the user + tenant + password in
 * `/admin` (A4) and the user signs in here with the credentials they were
 * given. There is no self-service signup.
 *
 * Security notes:
 *   * We never surface whether the email exists. Any auth failure (wrong
 *     password, unknown user, unconfirmed email) is reported as the same
 *     generic message.
 *   * Email is trim+lowercased before submission to match how Supabase
 *     stores auth.users.email (lowercase).
 */
export async function loginAction(formData: FormData): Promise<void> {
  const email = String(formData.get('email') ?? '')
    .trim()
    .toLowerCase();
  const password = String(formData.get('password') ?? '');

  if (!email || !password) {
    redirect(
      `/login?error=${encodeURIComponent('Email e senha obrigatórios')}`,
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // Never leak whether the email exists — generic message.
    redirect(
      `/login?error=${encodeURIComponent('Email ou senha incorretos')}`,
    );
  }

  redirect('/home');
}
