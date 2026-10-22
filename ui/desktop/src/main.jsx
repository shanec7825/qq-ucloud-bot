import React from 'react';
import { createRoot } from 'react-dom/client';
import { createBridgeStore, installBridge } from './bridge.js';
import { App } from './App.jsx';

// window.renderStatus / window.renderProgress are installed synchronously while this classic bundle loads.
const store = createBridgeStore();
installBridge(store);
createRoot(document.getElementById('root')).render(<App store={store}/>);
