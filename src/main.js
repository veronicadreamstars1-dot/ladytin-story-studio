import'./route-bootstrap.js';
import{ensureSharedSession}from'./shared-auth-bootstrap.js';

ensureSharedSession()
  .then(async()=>{
    document.body.innerHTML='<div id="root"></div>';
    await Promise.all([import('./app.js'),import('./zip-ui.js')]);
  })
  .catch(error=>{
    console.error('LadyTin application bootstrap failed:',error);
    document.body.innerHTML='<div class="auth-shell"><div class="auth-card"><h1>LadyTin Story Studio</h1><p class="auth-note" style="color:var(--bad)">Could not start the application securely. Refresh and try again.</p></div></div>';
  });
