# Japan rebalance: first-stage implementation

Base: `Tnktnk300/trainsworld` main, `6b8ef91729e1e5812f3dcbaedd6c0a49fed6a84b`.
Work branch: `japan-rebalance`. Upstream `circularsquare/trainsworld` is not a publication target.

## 実装と調査結果

### 1. 日本の鉄道需要

`COUNTRY_ASC_RAIL` の旧 +0.5 は復活させない。現在の `ratio_share` は鉄道と自動車の
費用比を使い、`asc_rail` は主に徒歩との競合にしか効かないため、その復活では目的とずれる。

日本だけ、費用比・フェードを計算した後の鉄道／自動車オッズを補正する。
`JAPAN_RAIL_MAX_UPLIFT = 0.05` を明示した暫定のゲームバランス上限として、
`k = ((1+d)/(1-d))^2`、`s' = k*s/(1+(k-1)*s)` から補正係数を導出する。
最大増分は `(sqrt(k)-1)/(sqrt(k)+1) = d` なので、どの元シェアでも最大5ポイント。
同費用なら50%から約55%になる。これは実測需要から校正した値ではない。

- `JAPAN_RAIL_MAX_UPLIFT`、`JAPAN_RAIL_ODDS`、`COUNTRY_RAIL_ODDS` を分離。
- `Params::rail_odds` を1に戻せば無補正との比較ができる。
- ローカル通勤、日常目的、パック間通勤・日常目的に出発地の国を適用。
- 徒歩判定、徒歩との競合式、アクセス、運賃、混雑・定員、元の需要総量を維持。
- 普通・快速といった系統名や停車パターンに直接ボーナスを付けない。
- 日本以外は恒等分岐を使い、需要・乗車数のビット一致を確認。
- 長距離旅行の生成・選択と `pipeline/longhaul.json` は維持。

### 2. 途中駅折返し

路線／グループの「途中折返し系統を作る」で途中駅と残す起終点を選び、系統を作成する。
`copy_line` の処理を共通化し、`end_line_at` と同じ `dropped` で元の経路を切り詰める。
複製・経路短縮・グループへの追加は1回の検証済み編集とUndoにまとめ、失敗時に
中途半端な複製やグループを残さない。`turn_end` はバルーンループ用なので流用しない。

作成後は既存のグループ図を全駅表示で開く。全区間・短区間・快速の停車／通過を
既存のレイアウトで比較できる。グループ内の系統別操作は折りたたみ、図を優先する。
複製は従来どおり列車数0で作成し、ダイヤは別途設定する。

### 3. 複々線操作

既存の複々線を2つの上下共用ペアのまま使用し、路線／グループ内に操作を追加。
通常画面から利用でき、`?pairs` は不要。

「隣のペアへ移動（上下とも）」は既存の `twin_plan` で隣接ホームと経路を検証し、
普通・快速を別ペアに配置する。グループ、停車パターン、手動の列車数、設定した
運転間隔を保持し、上下共通の運転へ変更する。自動ダイヤの必要列車数は新経路で再計算する。

`linePairs` の両ペア共用設定、`Twin::Parent` / `Twin::Of`、hidden twinの縮退・復帰を維持。
両ペア共用中の系統を移動するときは、列車数・運転間隔を全系統分に戻してhidden twinを
解除する。移動と解除は同じ編集・Undoに含める。保存形式・保存バージョンは変更しない。

## 変更ファイル

- 需要: `sim/src/demand/api.rs`、`kernel.rs`、`kernel/mode.rs`、`intercity/pass.rs`。
- 需要テスト: `sim/src/demand/api/tests.rs`、`kernel/tests.rs`、`intercity/tests.rs`。
- 路線編集: `sim/src/track/wasm/lines.rs`、`twin.rs`。
- 路線編集テスト: `sim/src/track/wasm/stop_edit_tests.rs`、`twin_tests.rs`。
- 画面: `app/src/ui/inspector/ShortTurnCreator.tsx`、`QuadLineControls.tsx`、
  `LineInspector.tsx`、`GroupInspector.tsx`、`app/src/ui/style.css`。
- 既存操作との接続: `app/src/workers/protocol.ts`、`clock.worker.ts`、
  `app/src/game/world.ts`、`editNote.ts`、`app/src/map/buildSound.ts`。
- 文言: `app/src/i18n/messages/en.json`、`messages/ja.json`、`sources/ja.json`、`context.json`。
- 回帰チェック: `checks/japan-operations.mjs`。
- 仕様記述: `docs/demand-mode.md`、`demand-worldwide.md`、`zones.md`、`ui-inspectors.md`、本書。

## 検証

既存テストの期待値は変更していない。通常のRustテストと需要機能付きテストは、変更前から実行。

| 確認 | 結果 |
| --- | --- |
| 変更前 `cargo test --release` | 562成功、失敗0、9 ignored |
| 変更後 `cargo test --release` | 566成功、失敗0、9 ignored |
| 変更前 `cargo test --release --features demand --lib` | 739成功、8失敗、37 ignored |
| 変更後 `cargo test --release --features demand --lib` | 746成功、8失敗、37 ignored。失敗したテスト名は変更前と完全一致 |
| `npm run check` | 成功 |
| `node trainworld/checks/i18n.mjs --no-scan` | 成功 |
| `node trainworld/checks/t145-check.mjs` | 成功 |
| `node trainworld/checks/t146-check.mjs` | 成功 |
| `vite build` | 成功。既存の大きなチャンク等の警告あり |
| `t1791-layout.mjs` | 合成ケース・同梱NYC保存の検証は成功。未同梱 `data/packs/real/tyo.save` の読み込みで停止 |
| 既存 `t3333-pairs.mjs` | Linuxソフトウェア描画環境の地図クリックで隣接ホームを作成できず失敗。テストは変更していない |
| 新規 `japan-operations.mjs` | 実ワーカー／WASMで途中折返し、キャンセル、グループ図、別ペア移動、Undo/Redo、hidden twin縮退・復帰を確認 |

追加したRustテストは7件。需要補正の上限とフェード、日本以外の計算一致、実パック初期化と
SIMD需要計算、パック間日常需要、短区間コピー、別ペア移動、hidden twin解除、拒否時の
不変性、保存・Undo/Redoを検証する。

WASMは通常の `npm run wasm` を試行したが、Binaryen 117のダウンロードに失敗した。
Cargo設定は変えず、`--no-opt` でtrack／demand両モジュールを生成して型・画面・製品ビルドを検証。
ブラウザチェックはLinuxのPlaywright Chromium／SwiftShaderを使用。
外部地図・データホストのリソースエラーは、アプリケーションの例外と区別する。

需要テストの既存失敗8件（実データを使用する地域間テスト）:

- `a_streamed_pass_is_the_pass_to_the_bit`
- `a_window_keeps_its_pairs_trips`
- `far_chunk_pairs_keep_each_place_pairs_trips`
- `fare_factors_weigh_trips_by_their_origin`
- `sampled_pairs_keep_each_zones_trips_with_each_place`
- `sampled_selection_rail_stays_within_trips`
- `the_explorer_counts_commutes_as_the_selection`
- `the_window_keeps_every_trip`

## 既知の制約と次の改善

1. 日本の5ポイント上限は暫定のゲームバランス方針。東京・大阪・地方圏の同じ実ネットワーク、
   同じ運賃・ダイヤで補正有無を比較し、通勤・普通・快速の実績と照合して調整する。
2. 方向別複々線の物理的なDDUU配列や渡り線の新設は実装していない。既存の2つの上下共用ペアを
   一体として操作する第一段階。部分区間だけのペア指定には、将来別の小さな拡張が必要。
3. ペア移動には、系統の全停車駅に対応する隣接ホームと接続経路が必要。既存の検証を緩めない。
4. 途中折返しの対象は通常の鉄道路線。環状線・バルーン・バス・フェリーは既存操作を使う。
5. 6GBの実データ一式は未取得。実データ依存テストと全データのsmokeを完了できていない。
   データを揃えた環境で再確認する。既存ブラウザの座標クリックも適合する環境で再実行する。
6. 新しい保存データ構造やダイヤ体系、ゲーム全体のルール変更は導入していない。
