import { Link } from 'react-router-dom';
import { useSession } from '../App.jsx';
import EnergyChart from '../components/EnergyChart.jsx';
import { Empty, IncidentState, Loading, Notice, PageHeader, Section, SourceLabel, fmtNum, fmtRupees, fmtTime } from '../components/ui.jsx';
import { useData } from '../services/api.js';

function Figure({ label, value, unit, note, tag }) {
  return (
    <div className="border-l-4 border-teal py-1 pl-3">
      <p className="text-[0.85rem] font-semibold text-muted">{label}</p>
      <p className="num text-[1.9rem] font-bold leading-tight" style={{ fontStretch: '85%' }}>
        {value} {unit && <span className="text-[1rem] font-semibold text-muted">{unit}</span>}
      </p>
      <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[0.82rem] text-muted">{tag && <SourceLabel label={tag} />}{note}</p>
    </div>
  );
}

export default function Overview() {
  const { user } = useSession();
  const summary = useData('/analytics/summary', { live: ['energy.updated', 'incident.updated', 'recommendations.updated'] });
  const intervals = useData('/analytics/intervals', { live: ['energy.updated'] });
  const incidents = useData('/incidents?active=true', { live: ['incident.updated'] });
  const staff = user.role !== 'viewer' && user.role !== 'teacher';
  const integrations = useData(staff ? '/integrations' : null, { enabled: staff, pollMs: 60000 });

  return (
    <>
      <PageHeader title="Overview" lead="Building-level electricity, what was expected, and what needs someone's attention." />
      <Loading state={summary}>
        {(s) => (
          <div className="space-y-5">
            <Section title={`${s.installation.name}, meter ${s.installation.meterId}`}>
              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
                <Figure
                  label={`Energy today (${s.today.localDate})`}
                  value={fmtNum(s.today.energyKwh, 1)}
                  unit="kWh"
                  tag={s.today.sourceLabel}
                  note={`${fmtNum(s.today.coveredHours, 1)} of ${fmtNum(s.today.elapsedHours, 1)} hours covered${s.today.coverageComplete ? '' : ': partial data'}`}
                />
                <Figure label="Expected so far" value={fmtNum(s.today.expectedKwh, 1)} unit={s.today.expectedKwh == null ? '' : 'kWh'} tag="Estimated" note={s.today.expectedKwh == null ? 'Insufficient baseline data' : 'From comparable past intervals'} />
                <Figure label="Energy cost today" value={fmtRupees(s.today.estimatedEnergyCost)} tag="Estimated" note={s.today.costLabel.replace('Estimated, ', '')} />
                <Figure
                  label="Possible saving per month"
                  value={`${fmtRupees(s.potentialSavings.costLow)}–${fmtRupees(s.potentialSavings.costHigh).slice(1)}`}
                  tag="Estimated"
                  note={`${fmtNum(s.potentialSavings.kwhLow, 0)}–${fmtNum(s.potentialSavings.kwhHigh, 0)} kWh. ${s.potentialSavings.note}.`}
                />
              </div>
              <p className="mt-4 text-[0.85rem] text-muted">
                {s.latestReading ? (
                  <>Latest accepted reading: <span className="num">{fmtNum(s.latestReading.value, 1)} kWh</span> at {fmtTime(s.latestReading.capturedAt)} <SourceLabel label={s.latestReading.sourceLabel} /></>
                ) : (
                  'No meter reading has been accepted yet.'
                )}
                {s.counts.readingsNeedingReview > 0 && (
                  <> · <Link to="/energy" className="text-teal underline">{s.counts.readingsNeedingReview} reading{s.counts.readingsNeedingReview > 1 ? 's need' : ' needs'} review</Link></>
                )}
              </p>
            </Section>

            <Section title="Actual against expected, last 48 hours" aside={<Link to="/energy" className="text-teal underline">Open energy</Link>}>
              <Loading state={intervals}>{(d) => <EnergyChart intervals={d.intervals} />}</Loading>
              <p className="mt-2 text-[0.82rem] text-muted">Each bar is energy over one interval. Hourly readings cannot show instantaneous or peak demand.</p>
            </Section>

            <div className="grid gap-5 lg:grid-cols-2">
              <Section title="Needs attention" aside={<Link to="/incidents" className="text-teal underline">All incidents</Link>}>
                <Loading state={incidents}>
                  {(d) =>
                    d.incidents.length === 0 ? (
                      <Empty>Nothing is open. New incidents appear here as soon as they are raised.</Empty>
                    ) : (
                      <ul className="divide-y divide-rule">
                        {d.incidents.slice(0, 6).map((i) => (
                          <li key={i.id} className="py-2">
                            <Link to={`/incidents/${i.id}`} className="font-semibold text-teal underline">{i.title}</Link>
                            <p className="mt-1 flex flex-wrap items-center gap-2 text-[0.85rem] text-muted">
                              <IncidentState state={i.state} />
                              {i.dataMode !== 'live' && <SourceLabel label="Simulated" />}
                              <span className="num">opened {fmtTime(i.openedAt)}</span>
                            </p>
                          </li>
                        ))}
                      </ul>
                    )
                  }
                </Loading>
              </Section>

              <Section title="Connections">
                {!staff ? (
                  <Empty>Connection status is shown to facilities staff.</Empty>
                ) : (
                  <Loading state={integrations}>
                    {(d) => (
                      <ul className="divide-y divide-rule">
                        {d.integrations.map((i) => (
                          <li key={i.id} className="flex flex-wrap items-baseline justify-between gap-2 py-1.5">
                            <span>{i.name ?? i.sourceId}</span>
                            <span className="text-[0.85rem]">
                              {i.health === 'connected' ? <strong className="text-green">Connected</strong> : i.health === 'degraded' ? <strong className="text-red">Stopped reporting</strong> : <span className="text-muted">{i.health === 'unavailable' ? 'Not available' : 'No data yet'}</span>}
                              {i.dataMode && i.dataMode !== 'live' && <> <SourceLabel label="Simulated" /></>}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </Loading>
                )}
              </Section>
            </div>
            {s.today.sourceLabel === 'Simulated' && <Notice tone="warn">The meter data on this page is synthetic demo data. It is labelled Simulated wherever it appears and is not a real measurement.</Notice>}
          </div>
        )}
      </Loading>
    </>
  );
}
