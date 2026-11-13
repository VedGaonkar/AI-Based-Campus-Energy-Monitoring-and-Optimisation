// Central Gemini budget. Every request that could reach Gemini must hold a reservation from here.
// Counts live in SQLite, so a restart cannot reset the daily total or the current minute.

const PRIORITY = { admin_action: 3, admin_query: 2, viewer: 1 };

export function quotaDay(ms, tz) {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
}

export function createBudget({ store, quota, now = () => Date.now() }) {
  const { stmts } = store;
  const minuteKey = 'blocked_until';

  const blockedUntil = () => Number(stmts.getState.get(minuteKey)?.value ?? 0);

  function snapshot() {
    const t = now();
    const day = quotaDay(t, quota.resetTz);
    const minute = stmts.countMinute.get(t - 60_000);
    const used = stmts.countDay.get(day).n;
    return {
      day,
      usedToday: used,
      remainingToday: Math.max(0, quota.rpd - used),
      usedLastMinute: minute.n,
      perMinute: quota.rpm,
      perDay: quota.rpd,
      adminReserve: quota.adminReserve,
      pausedUntil: blockedUntil() > t ? new Date(blockedUntil()).toISOString() : null,
    };
  }

  // Returns a reservation or the exact reason there is none. Called before every Gemini request.
  function reserve({ userId, priority }) {
    return store.transaction(() => {
      const t = now();
      const day = quotaDay(t, quota.resetTz);
      const rank = PRIORITY[priority] ?? 1;
      const isAdmin = rank > 1;

      const paused = blockedUntil();
      if (paused > t) return denied('remote_rate_limit', Math.ceil((paused - t) / 1000));

      const used = stmts.countDay.get(day).n;
      const dailyCeiling = isAdmin ? quota.rpd : quota.rpd - quota.adminReserve;
      if (used >= dailyCeiling) {
        return denied(used >= quota.rpd ? 'daily_quota' : 'daily_reserve', secondsUntilNextDay(t, quota.resetTz));
      }

      const minute = stmts.countMinute.get(t - 60_000);
      // Viewers leave one slot per minute free for administrators.
      const minuteCeiling = isAdmin ? quota.rpm : Math.max(1, quota.rpm - 1);
      if (minute.n >= minuteCeiling) {
        return denied('minute_quota', Math.max(1, Math.ceil((minute.oldest + 60_000 - t) / 1000)));
      }

      const perUser = stmts.countDayUser.get(day, userId);
      const userCap = isAdmin ? quota.adminPerUserDaily : quota.viewerPerUserDaily;
      if (perUser.n >= userCap) return denied('user_daily', secondsUntilNextDay(t, quota.resetTz));

      const last = stmts.lastUserCall.get(userId)?.last ?? 0;
      if (t - last < quota.userMinIntervalMs) return denied('user_throttle', Math.ceil((quota.userMinIntervalMs - (t - last)) / 1000));

      const info = stmts.insertCall.run(t, day, userId, priority, 'reserved');
      return { ok: true, id: Number(info.lastInsertRowid), remainingAfter: quota.rpd - used - 1 };
    });
  }

  const denied = (reason, retryAfterSec) => ({ ok: false, reason, retryAfterSec });

  return {
    snapshot,
    reserve,
    settle(reservation, outcome) {
      if (reservation?.id) stmts.setOutcome.run(outcome, reservation.id);
    },
    // Gemini itself said 429: stop sending anything until its retry window has passed.
    pauseFor(seconds) {
      const until = now() + Math.max(1, seconds) * 1000;
      if (until > blockedUntil()) stmts.putState.run(minuteKey, String(until));
    },
  };
}

function secondsUntilNextDay(t, tz) {
  // Walk forward in coarse steps until the quota date changes; cheap and DST-safe.
  const today = quotaDay(t, tz);
  let probe = t;
  for (let i = 0; i < 26; i += 1) {
    probe += 3_600_000;
    if (quotaDay(probe, tz) !== today) {
      probe -= 3_600_000;
      while (quotaDay(probe, tz) === today) probe += 60_000;
      return Math.ceil((probe - t) / 1000);
    }
  }
  return 3600;
}

export const REASON_TEXT = {
  daily_quota: 'the daily Gemini request allowance is used up',
  daily_reserve: 'the shared daily allowance is being kept for administrator actions',
  minute_quota: 'too many AI requests were made in the last minute',
  user_daily: 'you have reached your daily share of AI requests',
  user_throttle: 'AI requests are limited to one every few seconds per person',
  remote_rate_limit: 'Gemini asked us to slow down',
};
