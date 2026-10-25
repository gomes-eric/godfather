import type { ConfigStore } from '../config/store.js';
import type { ManagedObjectStore } from '../db/managed-objects.js';
import { applySetup, panelMessagesToCheck, type ApplyResult } from '../setup/applier.js';
import { buildDesiredState } from '../setup/desired.js';
import type { GuildSnapshot, SetupPlan } from '../setup/model.js';
import { planSetup } from '../setup/planner.js';
import type { GuildPort } from '../setup/port.js';

export interface PlannedSetup {
  plan: SetupPlan;
  snapshot: GuildSnapshot;
}

/** server.yaml → Discord reconciliation (PLAN.md §6.1). */
export class SetupService {
  constructor(
    private readonly port: GuildPort,
    private readonly store: ManagedObjectStore,
    private readonly config: ConfigStore,
  ) {}

  async plan(prune: boolean): Promise<PlannedSetup> {
    const desired = buildDesiredState(this.config.get());
    const snapshot = await this.port.snapshot(panelMessagesToCheck(this.store, desired.panels));
    const plan = planSetup({ desired, snapshot, managed: this.store.all(), prune });
    return { plan, snapshot };
  }

  async apply(planned: PlannedSetup): Promise<ApplyResult> {
    return applySetup(planned.plan, {
      port: this.port,
      store: this.store,
      snapshot: planned.snapshot,
    });
  }
}
