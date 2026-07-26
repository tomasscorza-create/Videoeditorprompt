import { initProjectUi, initShellUi } from './ui/index.js';
import './style.css';

initShellUi();
void initProjectUi().catch((error: unknown) => {
  console.error('No se pudo inicializar la interfaz del proyecto.', error);
});
