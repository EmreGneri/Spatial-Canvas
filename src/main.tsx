import { createRoot } from 'react-dom/client';
import App from './App';
import { HataSinir } from './ui/HataSinir';

// Sınır App'in DIŞINDA: App'in kendi mount'u (Engine kurulumu, WebGL bağlamı)
// çökerse de yakalanmalı. İçeride olsaydı çöken ağaç sınırı da götürürdü.
createRoot(document.getElementById('root')!).render(
  <HataSinir>
    <App />
  </HataSinir>,
);
