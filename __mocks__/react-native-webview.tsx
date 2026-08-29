import { forwardRef, useImperativeHandle } from 'react';
import { View, type ViewProps } from 'react-native';

/**
 * The web view, off-device.
 *
 * A native view with nothing to bind to, so importing it at all throws under
 * Jest — `RNCWebViewModule could not be found`, thrown at import time, which
 * takes down every test in any file that reaches it however indirectly.
 *
 * **It renders its props rather than a page**, which is what the tests here are
 * about: what URL it was pointed at, and whether a navigation is allowed. The
 * page itself is the planner's, and the planner has its own suite.
 */

export interface WebViewNavigation {
  readonly url: string;
}

interface Props extends ViewProps {
  readonly source?: { readonly uri?: string };
  readonly onShouldStartLoadWithRequest?: (event: WebViewNavigation) => boolean;
  readonly onLoadStart?: () => void;
  readonly onLoadEnd?: () => void;
  readonly onError?: () => void;
  readonly onHttpError?: () => void;
  readonly injectedJavaScript?: string;
  readonly onMessage?: unknown;
}

export interface WebViewHandle {
  reload: () => void;
}

export const reload = jest.fn();

export const WebView = forwardRef<WebViewHandle, Props>(function WebView(props, ref) {
  useImperativeHandle(ref, () => ({ reload }));
  return (
    <View
      testID="web-view"
      accessibilityLabel={props.source?.uri ?? ''}
      // Handed through so a test can ask what the view would do with a
      // navigation without pretending to be WebKit.

      {...({
        allow: props.onShouldStartLoadWithRequest,
        injected: props.injectedJavaScript,
        // So a test can make the page fail to arrive without a network.
        fail: props.onError,
        failHttp: props.onHttpError,
      } as any)}
      style={props.style}
    />
  );
});
