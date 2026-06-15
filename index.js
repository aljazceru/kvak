/**
 * @format
 */

// Polyfills must run before the rest of the app (and before any nostr-tools
// module loads, which the ContextVM / Nostr MCP integration depends on):
//   - crypto.getRandomValues: required by @noble (signing keys, nonces). Hermes
//     has no WebCrypto; react-native-get-random-values provides an OS-backed
//     CSPRNG via a native TurboModule.
//   - TextEncoder/TextDecoder: missing in Hermes; nostr-tools instantiates
//     `new TextDecoder('utf-8')` at the top of every module for NIP-44.
import 'react-native-get-random-values';
import './src/services/textencoding-polyfill';

import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => App);
