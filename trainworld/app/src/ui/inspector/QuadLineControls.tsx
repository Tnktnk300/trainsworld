import { useRef, useState } from "preact/hooks";
import type { LineInput, LineStats } from "../../game/types";
import { edit, stationNames, world } from "../../game/world";
import { t } from "../../i18n";
import { Alert, Check } from "../widgets";
import { useClockQuery } from "../useClockQuery";
import type { EditOp } from "../../workers/protocol";

/** A quad remains two ordinary bidirectional pairs. Pooling still uses the existing hidden twin. */
export function QuadLineControls({ l, st }: { l: LineInput; st?: LineStats }) {
  const w = world.value;
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const inFlight = useRef(false);
  const rail = !!st && !st.bus;
  const ans = useClockQuery(rail ? { what: "linePairs", line: l.num } : null, [l.num, w?.version], d => ({ ok: d[0] === 1, why: d.length >= 3 ? [d[1], d[2]] as const : null }));
  if (!w || !st || !rail || (!st.pairs && !ans?.ok)) return null;
  const name = (k: number) => stationNames(w).get(l.stops[k]) ?? "";
  const why = st.pairs === 2 && ans?.why;
  const notice = !why ? null
    : why[0] === 1 ? t("lineInspector.pairsStop", { station: name(why[1]) })
    : why[0] === 2 ? t("lineInspector.pairsHop", { from: name(why[1]), to: name(why[1] + 1) })
    : why[0] === 4 ? t("lineInspector.pairsUnbuilt")
    : t("lineInspector.pairsRoute");
  const change = async (op: EditOp) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setFailed(false);
    try { const a = await edit(op); setFailed(!a.ok); }
    catch { setFailed(true); }
    finally { setBusy(false); inFlight.current = false; }
  };
  return <div class="quad-service">
    <div class="h">{t("quadService.title")}</div>
    <p class="muted">{t("quadService.note")}</p>
    <p class="muted">{t("quadService.current", { stations: l.stops.map((_, k) => name(k)).join(" / ") })}</p>
    <fieldset disabled={busy}>
      <ul class="rows"><li>
        <Check checked={!!st.pairs} onChange={on => void change({ op: "linePairs", line: l.num, on })}>{t("lineInspector.pairs")}</Check>
      </li></ul>
      <button class="btn text" disabled={!ans?.ok} onClick={() => void change({ op: "lineMovePair", line: l.num })}>{t("quadService.move")}</button>
      {st.oneWay && <button class="btn text" onClick={() => void change({ op: "lineOneWay", line: l.num, oneWay: false })}>{t("quadService.twoWay")}</button>}
    </fieldset>
    {notice && <ul class="alerts"><Alert>{notice}</Alert></ul>}
    {failed && <p role="alert">{t("quadService.failed")}</p>}
  </div>;
}
