import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/archivo';
import './index.css';
import { App } from './App.tsx';

const racine = document.getElementById('root');

// Une assertion non nulle aurait suffi au compilateur et laisse, a l'execution,
// une page blanche sans explication le jour ou le gabarit change.
if (!racine) throw new Error("L'element #root est absent du document.");

createRoot(racine).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
