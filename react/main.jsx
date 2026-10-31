import { createRoot } from 'react-dom/client';
import { bootstrapGlobals } from '../js/core/bootstrap-globals.js';
import '../js/workflow/workflow-send-to-target.js';
import { App } from './App.jsx';

bootstrapGlobals();

const rootEl = document.getElementById('root');
if (!rootEl) {
    throw new Error('Root element #root not found');
}

createRoot(rootEl).render(<App />);
