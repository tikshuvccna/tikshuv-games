import { DIFFICULTY_MULT } from '@tikshuv/core';
import './styles/cf-base.css';

const app = document.getElementById('app')!;
app.innerHTML = `<main class="cf-hello"><h1>תיקי רשת</h1><p>המשרד לחקירות רשת פתוח. כתובת לדוגמה: <bdi dir="ltr">192.168.1.1</bdi></p><small>x${DIFFICULTY_MULT.hard}</small></main>`;
