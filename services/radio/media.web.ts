import { reservarMicrofone } from './audioFocus';
import { criarRadioMediaWeb } from './vozWeb';

// App no navegador (iPhone): mesma voz pelo servidor do painel da agência.
export const radioMedia = criarRadioMediaWeb(reservarMicrofone);
