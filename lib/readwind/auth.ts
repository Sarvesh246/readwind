import { createAuthClient } from "@neondatabase/auth";
import { BetterAuthReactAdapter } from "@neondatabase/auth/react/adapters";
export function createReadwindAuth(_url: string) {
  const client = createAuthClient(`${window.location.origin}/api/auth`, {
    adapter: BetterAuthReactAdapter(),
  });
  // Keep the SDK's dynamic method proxy outside React's state/prop inspection.
  return {
    getSession: () => client.getSession(),
    token: () => client.token(),
    signOut: () => client.signOut(),
    signIn: {
      email: (input: { email: string; password: string }) =>
        client.signIn.email(input),
    },
    signUp: {
      email: (input: { email: string; password: string; name: string }) =>
        client.signUp.email(input),
    },
    requestPasswordReset: (input: { email: string; redirectTo: string }) =>
      client.requestPasswordReset(input),
    resetPassword: (input: { newPassword: string; token: string }) =>
      client.resetPassword(input),
    emailOtp: {
      requestPasswordReset: (input: { email: string }) =>
        client.emailOtp.requestPasswordReset(input),
      resetPassword: (input: {
        email: string;
        otp: string;
        password: string;
      }) => client.emailOtp.resetPassword(input),
      verifyEmail: (input: { email: string; otp: string }) =>
        client.emailOtp.verifyEmail(input),
      sendVerificationOtp: (input: {
        email: string;
        type: "email-verification";
      }) => client.emailOtp.sendVerificationOtp(input),
    },
  };
}
export type AuthClient = ReturnType<typeof createReadwindAuth>;
