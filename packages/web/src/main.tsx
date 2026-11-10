// Entry point. The colour-scheme override is applied before React renders (the CSP forbids the usual inline
// head script, so this module is the earliest place it can run).
import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-500.css';
import '@fontsource/ibm-plex-sans/latin-600.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import '@xyflow/react/dist/style.css';
import './styles/tokens.css';
import './styles/layout.css';
import './styles/map.css';
import './styles/panels.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { applyStoredScheme } from './theme.ts';
import { App } from './components/App.tsx';

applyStoredScheme();
const root = document.getElementById('root');
if (root) createRoot(root).render(<StrictMode><App /></StrictMode>);
