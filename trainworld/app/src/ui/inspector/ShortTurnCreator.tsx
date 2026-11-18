// A path-preserving copy: stop indices belong to this snapshot until the player submits.
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import type { LineInput, LineStats } from "../../game/types";
import { groupAllStops } from "../../game/lineGroups";
import { selection } from "../../game/ui";
import { edit, stationNames, world } from "../../game/world";
import { live } from "../../map/live";
import { t } from "../../i18n";

export function ShortTurnCreator({ l, st }: { l: LineInput; st?: LineStats }) {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState("");
  const [keepStart, setKeepStart] = useState(true);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const inFlight = useRef(false);
  const signature = l.stops.join(",");
  useLayoutEffect(() => { setIndex(""); setFailed(false); }, [l.num, signature]);
  if (!st || st.bus) return null;
  const canCreate = !st.loop && l.stops.length >= 3 && st.status !== "broken";
  if (!canCreate && !l.group) return null;
  const names = world.value ? stationNames(world.value) : new Map<string, string>();
  const create = async () => {
    if (inFlight.current || !index) return;
    inFlight.current = true;
    setBusy(true);
    setFailed(false);
    try {
      // A stop edit arriving while the picker was open must never shorten at a different station.
      const current = world.peek()?.save.lines.find(x => x.num === l.num);
      if (!current || current.stops.join(",") !== signature) { setIndex(""); return; }
      const a = await edit({ op: "copyShortLine", line: l.num, index: Number(index), keepStart });
      if (!a.ok || a.line === undefined) { setFailed(true); return; }
      const made = world.peek()?.save.lines.find(x => x.num === a.line);
      setOpen(false);
      live.tools?.exit();
      groupAllStops.value = true;
      if (made?.group) selection.value = { kind: "group", group: made.group };
    } catch { setFailed(true); }
    finally { setBusy(false); inFlight.current = false; }
  };
  return <div class="short-turn">
    {canCreate && <button class={"btn text" + (open ? " on" : "")} aria-expanded={open} disabled={busy} onClick={() => setOpen(!open)}>{t("shortTurn.open")}</button>}
    {!!l.group && <button class="btn text" onClick={() => { groupAllStops.value = true; selection.value = { kind: "group", group: l.group! }; }}>{t("shortTurn.group")}</button>}
    {open && canCreate && <div class="callout">
      <label>{t("shortTurn.station")} <select aria-label={t("shortTurn.station")} value={index} disabled={busy} onChange={e => { setIndex(e.currentTarget.value); setFailed(false); }}>
        <option value="">{t("shortTurn.choose")}</option>
        {l.stops.slice(1, -1).map((s, i) => <option value={String(i + 1)}>{names.get(s) ?? s}</option>)}
      </select></label>
      <label>{t("shortTurn.keep")} <select aria-label={t("shortTurn.keep")} value={keepStart ? "start" : "end"} disabled={busy} onChange={e => setKeepStart(e.currentTarget.value === "start")}>
        <option value="start">{names.get(l.stops[0]) ?? l.stops[0]}</option>
        <option value="end">{names.get(l.stops.at(-1)!) ?? l.stops.at(-1)}</option>
      </select></label>
      <p class="muted">{t("shortTurn.note")}</p>
      {failed && <p role="alert">{t("shortTurn.failed")}</p>}
      <button class="btn" disabled={busy || !index} onClick={() => void create()}>{t("shortTurn.create")}</button>
      <button class="btn text" disabled={busy} onClick={() => setOpen(false)}>{t("shortTurn.cancel")}</button>
    </div>}
  </div>;
}
