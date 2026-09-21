import { createDataWorkspacePort } from './createDataWorkspacePort.js';
import { DataCenterPage } from '../pages/DataCenterPage.js';
import { DataWorkspaceSession } from '../pages/DataWorkspaceSession.js';

const DATA_PAGES = ['dashboard', 'downloads', 'datasets', 'validation', 'storage', 'experiments', 'strategies', 'journal', 'jobs', 'system'];

export function createDataFeature({ services, router }) {
  const dataWorkspace = createDataWorkspacePort({ ...services, datasetRepository: services.datasetRepository });
  const dataWorkspaceSession = new DataWorkspaceSession(dataWorkspace).init();
  const dataPages = new Map(DATA_PAGES.map((page) => [page, new DataCenterPage(dataWorkspaceSession, page)]));
  for (const page of DATA_PAGES) router.register(page, dataPages.get(page));

  return {
    dataWorkspace,
    dataWorkspaceSession,
    dataPages,
    destroy() {
      dataWorkspaceSession.destroy();
    },
  };
}

export { DATA_PAGES };
