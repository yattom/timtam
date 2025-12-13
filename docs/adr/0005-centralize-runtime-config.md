# ADR 0005: ランタイム設定の集約と公開設定の提供（CDK 中心）

- Status: Proposed
- Date: 2025-12-13
- Owners: timtam PoC チーム

## 背景 / Context
Bedrock（ap-northeast-1）では一部モデルが推論プロファイル（Inference Profile）経由でのみ呼び出し可能。
これまでクライアントから `region` や `modelId`（推論プロファイル ARN を含む）を直接渡していたが、
設定が分散しやすく、運用・安全性・一貫性の面で不利。目標は「Web クライアントは API ベース URL だけを
知り、その他の設定はバックエンド/インフラが責務を持つ」。

## 決定 / Decision
- CDK を設定の単一情報源（SSOT）とし、以下を実施する。
  - Lambda の既定値は環境変数で配布（Secrets は置かない）。
    - OrchestratorFn: `BEDROCK_REGION=ap-northeast-1`, `BEDROCK_MODEL_ID=<inference-profile-arn>`（必要時 `BEDROCK_INFERENCE_PROFILE_ARN`）。
    - TtsFn: `TTS_DEFAULT_VOICE=Mizuki`。
    - 実アクセス制御は IAM で最小権限（`bedrock:InvokeModel*`, `polly:SynthesizeSpeech`）。
  - Web には公開可の値のみを `GET /config` で提供。
    - 応答例:
      ```json
      {
        "apiBaseUrl": "https://<api-id>.execute-api.ap-northeast-1.amazonaws.com",
        "defaultRegion": "ap-northeast-1",
        "defaultModelId": "arn:aws:bedrock:ap-northeast-1:030046728177:inference-profile/global.anthropic.claude-haiku-4-5-20251001-v1:0",
        "ttsDefaultVoice": "Mizuki"
      }
      ```
    - クライアントは原則この値を使用。必要時のみ明示上書きを許容（後方互換）。
  - CDK からの露出経路
    - CloudFormation Outputs: `ApiEndpoint`, `DefaultBedrockRegion`, `DefaultModelId`, `TtsDefaultVoice`。
    - （任意）SSM Parameter Store（公開名前空間）: `/timtam/<stage>/public/*`。

## 影響 / Consequences
- `GET /config` 用の軽量 Lambda（ConfigFn）が増える。
- 公開値/非公開値の線引きを明確化し、公開 JSON に秘密を含めない運用が必要。
- ステージ（dev/stg/prd）毎の値切替は CDK 側（コンテキスト/マップ）で管理する前提。
- クライアントは `region`/`modelId` の指定が不要となり、誤設定リスクが低減。

## 代替案 / Alternatives
- フロントの .env に埋め込む（環境切替ごとに再ビルドが必要・秘匿/機動性に難あり）→ 不採用。
- API Gateway ステージ変数を直接参照（クライアント配布が煩雑）→ 不採用。

## 未決事項 / TBD
- `/config` に含める詳細項目（例: `availableModels`、ガードレール設定の可視化）。
- 推論プロファイル ARN の公開粒度（完全 ARN を出すか、ID のみにするか）。
- IAM のリソース絞り込みの具体（推論プロファイル/Polly 音声の限定）。
- ステージ毎の値の管理方式（CDK context vs. SSM）。

## 参考 / References
- Amazon Bedrock Inference Profiles（ドキュメント）
- AWS CDK v2（APIGW HTTP API, Lambda, Outputs, SSM Parameter Store）
