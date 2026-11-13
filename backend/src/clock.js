import { config } from './config.js';

let fixedNow = null;

// Wall-clock time. Tests may pin it; production never does.
export function now() {
  return fixedNow ? new Date(fixedNow) : new Date();
}

export function setNowForTests(date) {
  fixedNow = date ? new Date(date).getTime() : null;
}

export function advanceForTests(ms) {
  fixedNow = (fixedNow ?? Date.now()) + ms;
}

// Policy delays (vacancy confirmation, escalation, snooze, lease length) shrink by
// DEMO_TIME_SCALE in demo mode only. Timestamps themselves are always real, so stored
// dueAt values remain the single source of timing.
export function policyMs(minutes) {
  return (minutes * 60_000) / config().demoTimeScale;
}

export function addPolicyMinutes(date, minutes) {
  return new Date(new Date(date).getTime() + policyMs(minutes));
}
