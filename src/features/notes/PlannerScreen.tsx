import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { WebView, type WebViewNavigation } from 'react-native-webview';

import { ScreenHeader } from '@/components/ScreenHeader';
import { openPlanner } from '@/services/openMap';
import { colors, radius, spacing, typography } from '@/theme/tokens';

/**
 * The planner's own page, drawn inside the app.
 *
 * **This is a different thing from the sheet it replaces, and the difference is
 * worth stating rather than assuming.** `SFSafariViewController` ran out of
 * process: a separate browser with its own storage that this app could neither
 * read nor steer. A `WKWebView` is *in* this process. It is the app's own view,
 * so the app is capable of injecting JavaScript into the page, reading what is
 * on it, and deciding where it may go.
 *
 * So the rules below are what make the capability unused, and they are the
 * design rather than the polish:
 *
 * - **Nothing is injected.** No `injectedJavaScript`, no `injectedJavaScriptBeforeContentLoaded`,
 *   no message handler. The page is not spoken to and does not speak back.
 * - **It may only be the planner.** Anything navigating away from that origin is
 *   refused here and handed to the system browser instead — a link to a shop or
 *   a search result is not something to open inside an app holding somebody's
 *   diary, and an embedded view is exactly where that would go unnoticed.
 * - **Its cookies are its own.** The session the planner sets belongs to this
 *   view; nothing here reads it, and signing in once is why the page is usable
 *   at all.
 *
 * **Off the VPN it does not load, and that is an ordinary state rather than an
 * error.** This is the first tab, so it is what the app opens on — and a phone
 * that is simply not on the VPN would otherwise land on a blank screen with a
 * WebKit error in it. So the first failure moves you to the Day screen, which
 * is the tab you would have opened on before and works everywhere. A later
 * failure — you came back here on purpose and pressed reload — says so and
 * stays put, because being moved off a page you deliberately opened is worse
 * than seeing why it is empty.
 */

interface PlannerScreenProps {
  /** Where the planner is. Empty is handled here: it is the ordinary fresh-install state. */
  readonly url: string;
  /**
   * Called once, when the page fails to arrive on the first try.
   *
   * The shell moves to the Day tab. Once only, and the reason is the difference
   * between launching off the VPN — where landing on an error is the app being
   * unhelpful — and pressing reload here on purpose, where being thrown to
   * another tab would be the app overruling you.
   */
  readonly onUnreachable?: () => void;
}

/**
 * The origin the view is allowed to stay on.
 *
 * Compared as an origin rather than a prefix: `https://tracker.triplec.ai.evil
 * .example` starts with the same characters and is somebody else's host.
 */
function originOf(url: string): string | null {
  const match = /^(https:\/\/[^/?#]+)/i.exec(url.trim());
  return match?.[1]?.toLowerCase() ?? null;
}

export function PlannerScreen({ url, onUnreachable }: PlannerScreenProps) {
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const webView = useRef<WebView>(null);
  // Refs, not state: nothing renders either, and the first-failure rule has to
  // survive the re-render that showing the failure causes.
  const toldOnce = useRef(false);
  const home = originOf(url);
  // **Settings arrive a moment after the app does**, and this is the first tab,
  // so for that moment there is no address to load. Blank is the wrong answer
  // to that and also the wrong answer to a fresh install where nobody has typed
  // one — a tab that draws nothing is a tab that looks broken.
  const unset = home === null;

  const missed = () => {
    setLoading(false);
    setFailed(true);
    if (toldOnce.current) return;
    toldOnce.current = true;
    onUnreachable?.();
  };

  const retry = () => {
    setFailed(false);
    setLoading(true);
    webView.current?.reload();
  };

  /**
   * Whether the view may follow this navigation.
   *
   * Same-origin only. Everything else is handed to the system browser, where a
   * page can be looked at without being inside an app that holds a diary.
   */
  const allow = (event: WebViewNavigation): boolean => {
    // `about:blank` and the initial load arrive here too, and refusing those
    // would mean refusing to start.
    if (!event.url || event.url === 'about:blank') return true;
    if (home && originOf(event.url) === home) return true;
    void openPlanner(event.url);
    return false;
  };

  return (
    <View style={styles.screen}>
      <ScreenHeader
        title="Planner"
        subtitle="On the VPN, from the machine at home"
        actions={[{ label: 'Reload the planner', icon: 'refresh-outline', onPress: retry }]}
      />
      <View style={styles.body}>
        {unset ? (
          <View style={styles.waiting}>
            <Text style={styles.failedTitle}>No planner address</Text>
            <Text style={styles.waitingText}>
              Settings → Credentials → Planner. It is the machine at home, reached over the VPN.
            </Text>
          </View>
        ) : null}
        {unset ? null : (
          <WebView
            ref={webView}
            source={{ uri: url }}
            onLoadStart={() => setLoading(true)}
            onLoadEnd={() => setLoading(false)}
            onError={missed}
            // A 502 from the proxy is a failure the load itself does not report,
            // and it looks identical on screen to a page that never arrived.
            onHttpError={missed}
            onShouldStartLoadWithRequest={allow}
            // The planner writes a session cookie and reads it back; without this
            // signing in would not survive leaving the page.
            sharedCookiesEnabled
            // Nothing is injected and nothing is listened for. Stated as props so
            // that adding one is a visible change rather than an omission noticed
            // by nobody.
            injectedJavaScript={undefined}
            onMessage={undefined}
            // A page that cannot be reached is the ordinary state off the VPN, and
            // the view says so in its own words.
            startInLoadingState={false}
            allowsBackForwardNavigationGestures
            style={styles.web}
          />
        )}
        {loading && !failed && !unset ? (
          <View style={styles.waiting} pointerEvents="none">
            <ActivityIndicator color={colors.move} />
            <Text style={styles.waitingText}>Reaching the planner…</Text>
          </View>
        ) : null}
        {failed ? (
          <View style={styles.waiting}>
            <Text style={styles.failedTitle}>The planner is not answering</Text>
            {/* Names the likely cause without claiming to know it. The machine is
                on a VPN and is also a computer in a house: it may be off. */}
            <Text style={styles.waitingText}>
              It is on the VPN, and it is a computer in a house. Check you are connected, or that it is switched on.
            </Text>
            <Pressable onPress={retry} style={styles.retry} accessibilityRole="button">
              <Text style={styles.retryText}>Try again</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { flex: 1 },
  web: { flex: 1, backgroundColor: colors.background },
  waiting: {
    ...StyleSheet.absoluteFill,
    padding: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.background,
  },
  waitingText: { ...typography.caption, color: colors.textSecondary, textAlign: 'center' },
  failedTitle: { ...typography.body, color: colors.textPrimary },
  retry: {
    marginTop: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
  },
  retryText: { ...typography.body, color: colors.move, fontWeight: '600' },
});
