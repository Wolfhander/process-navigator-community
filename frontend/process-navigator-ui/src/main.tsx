import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';
import './accessibility.css';
import {installModalKeyboard} from './accessibility';

installModalKeyboard();

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);

