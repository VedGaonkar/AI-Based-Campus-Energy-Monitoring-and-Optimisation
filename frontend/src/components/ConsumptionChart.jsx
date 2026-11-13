import React, { useEffect, useId, useRef } from "react";
import { ResponsiveContainer, LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip } from "recharts";
import Help from "./Help.jsx";
import { baselineLabel, chartRows, comparison, consumptionCsv, freshness, hasBaseline, qualityWarnings, sourceLabel, totals } from "../services/consumption.js";
const number = n => Number.isFinite(n) ? n.toLocaleString("en-IN", { maximumFractionDigits: 2 }) : "Unavailable";
const colour = i => !hasBaseline(i) ? "var(--text-muted)" : i.energyKwh > i.baseline.expectedKwh ? "var(--consumption-above)" : "var(--consumption-below)";
const time = (value, timezone) => new Intl.DateTimeFormat("en-IN", { timeZone: timezone, dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
function Marker({ cx, cy, payload }) {
  if (!payload.interval || payload.actual === null || !Number.isFinite(cx) || !Number.isFinite(cy)) return null;
  const i = payload.interval;
  return <g><title>{comparison(i)}{i.anomalous ? " · Flagged anomaly" : ""}</title>{i.energyKwh > i.baseline?.expectedKwh ? <path d={`M${cx},${cy - 4}l4,4l-4,4l-4,-4Z`} fill={colour(i)} /> : <circle cx={cx} cy={cy} r={3} fill={colour(i)} />}{i.anomalous && <circle cx={cx} cy={cy} r={7} fill="none" stroke={colour(i)} />}</g>;
}
function BaselineMarker({ cx, cy, payload }) {
  return payload.interval && hasBaseline(payload.interval) && Number.isFinite(cx) && Number.isFinite(cy) ? <rect x={cx - 2} y={cy - 2} width={4} height={4} fill="var(--card-bg)" stroke="var(--text-primary)" /> : null;
}
function IntervalTooltip({ active, payload, timezone }) {
  const i = payload?.find(p => p.payload?.interval)?.payload.interval;
  if (!active || !i) return null;
  return <div className="interval-tooltip"><strong>{time(i.startAt, timezone)} – {time(i.endAt, timezone)}</strong><p>{number(i.energyKwh)} kWh · {comparison(i)}</p><p>Baseline: {number(i.baseline?.expectedKwh)} kWh</p><p>{baselineLabel(i)}</p><p>{i.anomalous ? "Flagged anomaly; cause unconfirmed" : "Not flagged as an anomaly"}</p><small>{sourceLabel(i)} · {i.coverage === "gap_aggregate" ? "Gap aggregate; hourly pattern unknown" : `${number(i.durationHours * 60)} min interval`}</small></div>;
}
export default function ConsumptionChart({ intervals = [], timezone = "Asia/Kolkata", onOpen }) {
  const data = chartRows(intervals), summary = totals(intervals), warnings = qualityWarnings(intervals);
  if (!intervals.length) return <div className="empty"><h3>No accepted intervals in this range</h3><p>Choose another range or import accepted meter readings.</p>{onOpen && <button type="button" className="text-link" onClick={onOpen}>View consumption details</button>}</div>;
  return <div className="consumption-profile">
    <div className="chart-legend"><span className="below">● At or below baseline</span><span className="above">◆ Above baseline</span><span>◯ Flagged anomaly <Help topic="anomaly" /></span><span>┄ Baseline · estimated <Help topic="baseline" /></span></div>
    <div className="chart-wrap" onClick={onOpen} style={onOpen ? { cursor: "pointer" } : undefined}>
      <ResponsiveContainer width="100%" height={290}>
        <LineChart data={data} accessibilityLayer margin={{ top: 15, right: 20, left: 0, bottom: 5 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 4" />
          <XAxis dataKey="time" type="number" domain={["dataMin", "dataMax"]} scale="time" minTickGap={70} tickFormatter={v => new Intl.DateTimeFormat("en-IN", { timeZone: timezone, month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(v))} tick={{ fontSize: 10, fill: "var(--text-muted)" }} />
          <YAxis width={55} label={{ value: "kWh", angle: -90, position: "insideLeft", fill: "var(--text-primary)" }} tick={{ fontSize: 11, fill: "var(--text-muted)" }} />
          <Tooltip content={<IntervalTooltip timezone={timezone} />} />
          <Line type="linear" dataKey="expected" name="Baseline · estimated kWh" stroke="var(--text-primary)" strokeDasharray="5 4" dot={<BaselineMarker />} connectNulls={false} isAnimationActive={false} />
          <Line type="linear" dataKey="below" stroke="var(--consumption-below)" strokeWidth={2.5} dot={false} activeDot={false} connectNulls={false} isAnimationActive={false} />
          <Line type="linear" dataKey="above" stroke="var(--consumption-above)" strokeWidth={2.5} dot={false} activeDot={false} connectNulls={false} isAnimationActive={false} />
          <Line type="linear" dataKey="unknown" stroke="var(--text-muted)" strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
          <Line dataKey="actual" name="Recorded energy kWh" stroke="none" dot={<Marker />} activeDot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
    <p className="caption">{intervals.every(i => Math.abs(i.durationHours - 1) < 0.001) ? "Hourly consumption" : "Consumption per original interval"} · {number(summary.actual)} kWh recorded · Baseline {summary.comparable ? `${number(summary.expected)} kWh across ${summary.comparable}/${summary.count} comparable intervals` : "unavailable"}.</p>
    <p className="caption">{[...new Set(intervals.map(baselineLabel))].join("; ")}. Lines interpolate between interval endpoints; they do not measure usage within an interval. Gap totals are isolated markers.</p>
    {warnings.map(w => <p className="quality-warning" key={w}>⚠ {w}</p>)}
    {onOpen && <button type="button" className="text-link" onClick={onOpen}>View consumption details, data and export →</button>}
  </div>;
}
export function ConsumptionDetails({ intervals, timezone, onClose, incidents = [], recommendations = [], relatedError, loadingRelated, syncState, filters }) {
  const dialog = useRef(), id = useId(), total = totals(intervals), latest = intervals.at(-1);
  useEffect(() => {
    const node = dialog.current, prior = document.activeElement;
    node.showModal();
    return () => { node.close(); prior?.focus(); };
  }, []);
  const ids = new Set(intervals.map(i => i._id));
  const relatedIncidents = incidents.filter(i => ids.has(i.evidence?.intervalId));
  const relatedRecommendations = recommendations.filter(r => ids.has(r.evidence?.intervalId));
  const download = () => {
    const url = URL.createObjectURL(new Blob([consumptionCsv(intervals)], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = "consumption-displayed-intervals.csv"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <dialog ref={dialog} className="consumption-dialog" aria-labelledby={id} onCancel={e => { e.preventDefault(); onClose(); }}>
    <div className="section-title"><h2 id={id}>Consumption details</h2><button type="button" className="button secondary" onClick={onClose} autoFocus>Close consumption details</button></div>
    {filters}
    <p>{intervals.length ? `${time(intervals[0].startAt, timezone)} – ${time(latest.endAt, timezone)} (${timezone})` : "No accepted intervals in this range"}</p>
    <p>Resolution: original recorded intervals; no hourly redistribution. Whole intervals inside the selected range only.</p>
    <p><strong>{total.count ? `${number(total.actual)} kWh recorded` : "Recorded energy unavailable"}</strong> · {total.comparable ? `${number(total.expected)} kWh baseline (${total.comparable}/${total.count} comparable)` : "Baseline unavailable"}</p>
    <p>{freshness(latest)} · {syncState === "current" ? "Workspace connected" : "Offline / synchronising: displayed data may be stale"} <Help topic="stale" /></p>
    <ConsumptionChart intervals={intervals} timezone={timezone} />
    <button type="button" className="button secondary" disabled={!intervals.length} onClick={download}>Export displayed intervals (CSV)</button>
    <p className="caption">Exports only the accepted energy records authorised for your workspace view, with the same range, source and calculations.</p>
    <div className="table-scroll" tabIndex={0} role="region" aria-label="Interval details; scroll horizontally for all columns"><table className="consumption-table"><thead><tr><th>Interval / source</th><th>Actual / baseline</th><th>Status</th><th>Quality / comparison</th></tr></thead><tbody>{intervals.map((i, index) => <tr key={i._id ?? index}><td>{time(i.startAt, timezone)} – {time(i.endAt, timezone)}<br />{sourceLabel(i)}<br />{number(i.durationHours * 60)} min · epoch {i.epoch}<br /><small>Readings: {i.sourceReadingIds?.join(", ") ?? "Unavailable"}</small></td><td>{number(i.energyKwh)} / {number(i.baseline?.expectedKwh)} kWh<br />{number(i.averagePowerKw)} kW average <Help topic="power" /></td><td>{comparison(i)}<br />{i.anomalous ? "Flagged anomaly; cause unconfirmed" : "Not flagged"}<br />Alert threshold: {number(i.baseline?.thresholdKwh)} kWh</td><td>{i.coverage === "gap_aggregate" ? "Gap aggregate; internal readings missing" : "Accepted interval"}<br />{baselineLabel(i)}<br />Samples: {i.baseline?.sampleCount ?? "Unavailable"} · version {i.baseline?.version ?? "Unavailable"}</td></tr>)}</tbody></table></div>
    <h3>Related anomalies and recommendations</h3>
    <p className="caption">Related records use the existing authorised incident/recommendation feeds; recent incident results are bounded by the API.</p>
    {relatedError ? <p role="alert">Related evidence unavailable: {relatedError}</p> : loadingRelated ? <p>Loading related evidence…</p> : <><p>{relatedIncidents.length ? "Anomalies in the selected intervals:" : "No related anomaly records returned for this range."}</p>{relatedIncidents.map(i => <p key={i._id}>{i.title} · {i.state} · cause unconfirmed</p>)}<p>{relatedRecommendations.length ? "Recommendations in the selected intervals:" : "No related recommendations returned for this range."}</p>{relatedRecommendations.map(r => <div key={r._id}><strong>{r.title} · {r.status}</strong><p>{r.explanation} {r.proposedAction}</p><p>Estimated saving: {number(r.estimate?.lowKwh)}–{number(r.estimate?.highKwh)} kWh <Help topic="savings" /> · {r.estimate?.assumptions}</p></div>)}</>}
  </dialog>;
}
