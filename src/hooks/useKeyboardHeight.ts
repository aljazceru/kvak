/**
 * useKeyboardHeight — tracks the on-screen soft-keyboard height so the UI can
 * lift content (compose bar, tab bar, the whole window) above it.
 *
 * Why this exists:
 *   With targetSdk 35+ (Android 15/16) the system enforces edge-to-edge, and
 *   `windowSoftInputMode="adjustResize"` no longer resizes the activity window
 *   the way it used to — the IME inset is dispatched and the app must consume
 *   it. As a result the keyboard just overlays the bottom of the app and the
 *   compose bar / what-you-are-typing gets hidden.
 *
 *   Returning the real keyboard height lets the root view apply it as bottom
 *   padding, which proportionally shrinks the flex:1 chat area and keeps the
 *   compose bar visible right above the keyboard.
 *
 * Returns the keyboard height in px (0 when closed).
 */
import { useEffect, useState } from 'react';
import { Keyboard, KeyboardEvent, LayoutAnimation, Platform } from 'react-native';

export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const isIOS = Platform.OS === 'ios';
    // iOS: use the will* events so we move in lockstep with the native animation.
    // Android: only did* events are available; we smooth the reflow via LayoutAnimation.
    const showEvent = isIOS ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = isIOS ? 'keyboardWillHide' : 'keyboardDidHide';

    const onShow = (e: KeyboardEvent) => {
      if (!isIOS) {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      }
      setHeight(e.endCoordinates?.height ?? 0);
    };

    const onHide = () => {
      if (!isIOS) {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      }
      setHeight(0);
    };

    const showSub = Keyboard.addListener(showEvent, onShow);
    const hideSub = Keyboard.addListener(hideEvent, onHide);
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  return height;
}
