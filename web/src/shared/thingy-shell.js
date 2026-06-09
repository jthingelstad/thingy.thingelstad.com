import { createAccountPanel } from './thingy-account.js';
import { createRailController } from './thingy-rail.js';

function createThingyShell(options = {}) {
  const rail = createRailController(options.rail || {});
  const account = createAccountPanel(options.account || {});

  return {
    account,
    rail,
    closeTransientUi: () => {
      account.close();
      rail.closeMobile();
    }
  };
}

export { createThingyShell };
