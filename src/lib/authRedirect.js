// lib/authRedirect.js
// Runs once per app load, after useAuthStore.init() resolves. Handles both
// possible outcomes of a Google OAuth round-trip (link or conflict) via two
// localStorage flags the auth actions set before redirecting:
//   - klondike:pendingLink      set by linkWithGoogle; landing back with an
//     error_code/error means the Google account was already linked to a
//     different user — surface the conflict dialog.
//   - klondike:pendingProfilePull  set when the player accepted the conflict and
//     we re-authed as the already-linked account; pull that account's data into
//     local Dexie now that the new session is established.

import { useAuthStore } from '../hooks/useAuthStore.js';
import { pullRemoteProfile } from '../sync/pullProfile.js';

export async function checkAuthRedirectResult() {
  const url = new URL(window.location.href);
  const hadPendingLink = localStorage.getItem('klondike:pendingLink') === '1';
  localStorage.removeItem('klondike:pendingLink');

  const hasErrorParams =
    url.searchParams.has('error') ||
    url.searchParams.has('error_description') ||
    url.searchParams.has('error_code');

  if (hadPendingLink && hasErrorParams) {
    useAuthStore.setState({
      linkConflict: {
        message:
          url.searchParams.get('error_description') ??
          'This Google account is already linked to another player.',
      },
    });
  }

  if (hasErrorParams) {
    url.searchParams.delete('error');
    url.searchParams.delete('error_description');
    url.searchParams.delete('error_code');
    window.history.replaceState(null, '', url.pathname + url.search);
  }

  const hadPendingPull = localStorage.getItem('klondike:pendingProfilePull') === '1';
  if (hadPendingPull) {
    localStorage.removeItem('klondike:pendingProfilePull');
    if (useAuthStore.getState().userId) {
      try {
        await pullRemoteProfile();
      } catch (e) {
        console.error('Failed to pull adopted profile after link-conflict resolution', e);
      }
    }
  }
}
