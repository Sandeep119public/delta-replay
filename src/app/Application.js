import { createCoreServices } from './createCoreServices.js';
import { createDataFeature } from './createDataFeature.js';
import { createApplicationRuntime } from './createApplicationRuntime.js';
import { renderTerminalLayout } from '../ui/TerminalLayout.js';
import { Router } from '../router/Router.js';

export { requireElement };
function requireElement(id, root = document) {
  const element = root.getElementById?.(id) || root.querySelector?.('#' + id);
  if (!element) throw new Error(`Required element #${id} is missing`);
  return element;
}

export function createApplication() {
  const services = createCoreServices();
  const mount = requireElement('app');
  renderTerminalLayout(mount);

  const router = new Router();
  router.register('replay');
  const dataFeature = createDataFeature({ services, router });
  router.init();

  const runtime = createApplicationRuntime({
    services,
    mount,
    router,
    requireElement,
    onDestroy: () => dataFeature.destroy(),
  });
  return {
    start: runtime.start,
    destroy: runtime.destroy,
    services,
    ui: runtime.ui,
    mobileDrawer: runtime.mobileDrawer,
    commandSurface: runtime.commandSurface,
    replayCapabilities: runtime.replayCapabilities,
    router,
    dataPages: dataFeature.dataPages,
    dataWorkspaceSession: dataFeature.dataWorkspaceSession,
    dataWorkspace: dataFeature.dataWorkspace,
  };
}
