ADR0006 — Transcript購読ロジック簡素化の方針（互換購読の扱い）

Status: Accepted（実装変更は当面保留）
Date: 2025-12-13

背景 / Context
Web クライアントは Amazon Chime SDK の文字起こしイベントを購読して Partial/Final を表示している。現在は以下の2経路を併用し、互換性を担保している:
- 第一候補: audioVideo.transcriptionController.subscribeToTranscriptEvent
- 互換候補: audioVideo.realtimeSubscribeToReceiveTranscriptionEvent（古い SDK/一部ブラウザ向けのフォールバック）

本番検証（Windows 11 + Chrome 142）では第一候補のみで安定動作を確認済み。互換候補は「保険」として残存。

決定 / Decision
- 互換購読は当面保持するが、運用観測のうえ段階的に廃止し、コードを簡素化する。
- イベントペイロード差（例: Transcript.Results と transcript.results の大小文字差、Items からの再構築）に対する正規化ロジックは維持する。

実施方針 / Plan
1. フラグで互換購読を切り替え可能にする（例: VITE_TRANSCRIPT_FALLBACK=0 を既定）。
2. 最新 Chrome/Edge/Firefox、Safari 16+ を対象に 1–2 日運用し、問題がないか確認する。
3. 問題がなければ realtimeSubscribeToReceiveTranscriptionEvent 分岐を削除する。
4. 正規化ロジックは残す。

代替案 / Alternatives
- 直ちに互換購読を削除: コードは最短でシンプルだが、旧環境でのリスクが読めない。
- 常に二重購読のまま: 互換性は最大だが、保守性・可読性が低下する。

影響 / Consequences
- 現行の本番環境では機能差は出ない（第一候補で動作）。
- 段階的オフ→削除により、旧環境のリスクを最小化しつつコードを簡素化できる。

備考 / Notes
- 互換購読が必要な実ブラウザ事例が観測された場合は、本方針を一旦保留し、根拠（ブラウザ/SDK バージョン、再現手順）を追記する。