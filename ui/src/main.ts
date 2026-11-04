import { needsWebViewUpdate, showWebViewUpdate } from './engine/webview';

// The app mounts only when its engine can work; see needsWebViewUpdate.
const root = document.getElementById('app')!;
if (needsWebViewUpdate()) showWebViewUpdate(root);
else void import('./app');
