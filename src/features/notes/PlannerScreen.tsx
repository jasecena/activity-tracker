import { useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { WebView, type WebViewNavigation } from 'react-native-webview';

import { ScreenHeader } from '@/components/ScreenHeader';
import { openPlanner } from '@/services/openMap';
import { colors, spacing, typography } from '@/theme/tokens';

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
 * **A failure is left as the browser's own.** The planner is on a VPN, so it
 * simply does not load when the phone is off it — which is not a state this app
 * can improve on, and a hand-written "could not connect" over the top of a page
 * that already says so is a second thing to keep true.
 */

interface PlannerScreenProps {
  /** Where the planner is. Empty never reaches here — the control that opens this is hidden. */
  readonly url: string;
  readonly onBack: () => void;
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

export function PlannerScreen({ url, onBack }: PlannerScreenProps) {
  const [loading, setLoading] = useState(true);
  const webView = useRef<WebView>(null);
  const home = originOf(url);

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
        onBack={onBack}
        actions={[
          {
            label: 'Reload the planner',
            icon: 'refresh-outline',
            onPress: () => webView.current?.reload(),
          },
        ]}
      />
      <View style={styles.body}>
        <WebView
          ref={webView}
          source={{ uri: url }}
          onLoadStart={() => setLoading(true)}
          onLoadEnd={() => setLoading(false)}
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
        {loading ? (
          <View style={styles.waiting} pointerEvents="none">
            <ActivityIndicator color={colors.move} />
            <Text style={styles.waitingText}>Reaching the planner…</Text>
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
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.background,
  },
  waitingText: { ...typography.caption, color: colors.textSecondary },
});
