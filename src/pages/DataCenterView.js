import { setPage } from './data-center/shared.js';
import { dashboard, downloads, datasets, validation, storage, jobs, system } from './data-center/operational.js';
import { researchPages } from './data-center/research.js';

function createDates(now = Date.now()) {
  const end = new Date(now - new Date().getTimezoneOffset() * 60000);
  const start = new Date(end.getTime() - 30 * 86400000);
  return { start: start.toISOString().slice(0, 16), end: end.toISOString().slice(0, 16) };
}

export function renderDataCenterPage({ element, page, snapshot, storageEstimate, download, jobsState = [], validationState, savedDatasets = [], localDatasets = [] }) {
  const dates = createDates();
  const renderers = {
    dashboard: () => dashboard(snapshot, storageEstimate),
    downloads: () => downloads(snapshot, download, dates),
    datasets: () => datasets(snapshot, savedDatasets, localDatasets),
    validation: () => validation(snapshot, validationState),
    storage: () => storage(snapshot, storageEstimate),
    jobs: () => jobs(jobsState),
    system: () => system(snapshot),
    ...researchPages,
  };
  const render = renderers[page];
  if (!render) throw new Error('Unknown data page: ' + page);
  setPage(element, render());
}
