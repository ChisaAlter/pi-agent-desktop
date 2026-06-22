import React from 'react';
import ReactDOM from 'react-dom/client';
import SettingsWindow from './SettingsWindow';
import './styles/globals.css';
import { applyFontSize, applyTheme, getInitialFontSize, getInitialTheme } from './utils/theme';

applyTheme(getInitialTheme());
applyFontSize(getInitialFontSize());

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <SettingsWindow />
  </React.StrictMode>
);
