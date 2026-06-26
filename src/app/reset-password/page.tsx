import ResetPassword from '@/screens/ResetPassword'

// Public landing for the password-reset email link. AppShell whitelists /reset-password so this renders
// even when signed out; the screen reads the recovery session (set by Supabase's detectSessionInUrl)
// and shows the set-a-new-password form.
export default function ResetPasswordRoute() {
  return <ResetPassword />
}
