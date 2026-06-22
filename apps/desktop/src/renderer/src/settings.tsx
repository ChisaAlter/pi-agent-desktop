import React from 'react';
import ReactDOM from 'react-dom/client';
import SettingsWindow from './SettingsWindow';
import './styles/globals.css';
import { applyTheme, getInitialTheme } from './utils/theme';

applyTheme(getInitialTheme());

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <SettingsWindow />
  </React.StrictMode>
);
