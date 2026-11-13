import { config } from '../config.js';
import { now } from '../clock.js';
import { ApiError } from '../services/core.js';

// Internal room-master contract (PLAN.md §11.6):
//   getCapabilities(breaker), getStatus(breaker), setSupply(breaker, on, requestId, expiresAt)
// Command results are persisted on the Command document, which serves getCommandResult(requestId).

export const simulatorAdapter = {
  name: 'simulator',
  dataMode: 'simulated',

  async getCapabilities(breaker) {
    return { supplyControl: true, stateFeedback: breaker.simulator?.feedback !== false, faultStatus: true, energyMetering: false, dataMode: 'simulated' };
  },

  async getStatus(breaker) {
    return {
      reportedSupply: breaker.supplyState,
      updatedAt: breaker.lastChangedAt ?? breaker.updatedAt,
      health: breaker.health,
      interlocks: breaker.interlocks,
      dataMode: 'simulated',
    };
  },

  // Explicit state, never a toggle: repeating the same request cannot reverse the output.
  async setSupply(breaker, on, _requestId, expiresAt) {
    if (now() > new Date(expiresAt)) {
      return { transportStatus: 'not_sent', reportedOutput: null, verification: 'unknown', expired: true, dataMode: 'simulated' };
    }
    if (breaker.simulator?.failTransport) {
      return { transportStatus: 'failed', reportedOutput: null, verification: 'unknown', dataMode: 'simulated' };
    }
    if (breaker.simulator?.feedback === false) {
      return { transportStatus: 'acknowledged', reportedOutput: null, verification: 'command_only', dataMode: 'simulated' };
    }
    // A simulated result stays "simulated" even though it reports the requested output.
    return { transportStatus: 'acknowledged', reportedOutput: on ? 'on' : 'off', verification: 'simulated', verifiedAt: now(), dataMode: 'simulated' };
  },
};

export function getRoomMasterAdapter(breaker) {
  const cfg = config();
  if (breaker.adapter === 'simulator') return simulatorAdapter;
  // Real switching adapters are never instantiated in demonstration mode.
  if (cfg.demoMode || !cfg.allowPhysicalControl) {
    throw new ApiError(409, 'physical_control_disabled', 'Physical control is disabled on this server');
  }
  throw new ApiError(503, 'adapter_unavailable', 'No physical room-master adapter is implemented. Select a breaker model with a documented interface first.');
}

export function adapterStatus() {
  const cfg = config();
  return {
    simulator: { available: true, dataMode: 'simulated' },
    physical: {
      available: false,
      reason: cfg.demoMode ? 'Disabled in demonstration mode' : 'No physical room-master adapter is implemented',
    },
  };
}
