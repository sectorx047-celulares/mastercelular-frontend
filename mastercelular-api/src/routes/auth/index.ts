// mastercelular-api/src/routes/auth/index.ts
// Rutas de autenticación
import { Hono } from 'hono';
import register from './register';
import login from './login';
import logout from './logout';
import activate from './activate';
import passwordChange from './password-change';

const app = new Hono();

app.route('/auth', register);
app.route('/auth', login);
app.route('/auth', logout);
app.route('/auth', activate);
app.route('/auth', passwordChange);

export default app;