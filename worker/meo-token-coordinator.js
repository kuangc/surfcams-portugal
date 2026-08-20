import { DurableObject } from "cloudflare:workers";

import { TokenCoordinatorCore } from "./token-coordinator-core.js";

export class MeoTokenCoordinator extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.core = new TokenCoordinatorCore({ storage: ctx.storage });
  }

  async getToken() {
    return this.core.getToken();
  }

  async refreshToken(failedRevision) {
    return this.core.refreshToken(failedRevision);
  }
}
