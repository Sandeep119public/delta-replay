import { header } from './shared.js';

function coming(title, detail) {
  return `<div class="data-page">${header('RESEARCH',title,detail)}<section class="data-panel empty-page"><strong>Workspace reserved</strong><p>The navigation is established now so future research features can attach to the same shell and job contracts.</p></section></div>`;
}

export const researchPages = Object.freeze({
  experiments: () => coming('Experiments','Experiment orchestration will consume the dataset and job contracts created here.'),
  strategies: () => coming('Strategies','Strategy definitions and walk-forward results will live here.'),
  journal: () => coming('Journal','Replay notes and research observations will be added here.'),
});
