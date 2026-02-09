"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import ConfigTab from "./ConfigTab";
import { GraspConfig, GroupedConfig, groupConfigsByName } from "@/lib/graspConfig";

interface TranscriptEntry {
  timestamp: number;
  speakerId: string;
  text: string;
  isFinal: boolean;
}

interface AIMessage {
  timestamp: number;
  message: string;
  nodeId?: string;
}

interface LLMLog {
  timestamp: number;
  nodeId?: string;
  prompt: string;
  rawResponse: string;
}

interface CurrentConfig {
  configId: string | null;
  name: string | null;
  yaml: string | null;
}

interface Meeting {
  meetingId: string;
  platform: string;
  status: string;
  meetingCode?: string;
  recallBot?: {
    botId: string;
    meetingUrl: string;
    platform: string;
    status: string;
  };
}

export default function MeetingDetailClient({ meetingId }: { meetingId: string }) {
  const router = useRouter();
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([]);
  const [aiMessages, setAiMessages] = useState<AIMessage[]>([]);
  const [llmLogs, setLlmLogs] = useState<LLMLog[]>([]);
  const [activeTab, setActiveTab] = useState<"transcript" | "ai" | "logs" | "config">("transcript");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [graspConfigs, setGraspConfigs] = useState<GraspConfig[]>([]);
  const [groupedConfigs, setGroupedConfigs] = useState<GroupedConfig[]>([]);
  const [currentConfig, setCurrentConfig] = useState<CurrentConfig | null>(null);
  const [selectedConfigId, setSelectedConfigId] = useState<string | null>(null);
  const [selectedConfigYaml, setSelectedConfigYaml] = useState<string>("");
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editedYaml, setEditedYaml] = useState<string>("");
  const [configName, setConfigName] = useState<string>("");
  const [originalConfigName, setOriginalConfigName] = useState<string>("");
  const [configLoading, setConfigLoading] = useState(false);
  const [applySuccess, setApplySuccess] = useState(false);
  const [originalYaml, setOriginalYaml] = useState<string>("");

  useEffect(() => {
    const fetchMeeting = async () => {
      try {
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || "https://your-api-gateway.amazonaws.com";
        const response = await fetch(`${apiUrl}/recall/meetings/${meetingId}`);

        if (!response.ok) {
          throw new Error("会議情報の取得に失敗しました");
        }

        const data = await response.json();
        setMeeting(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "エラーが発生しました");
      } finally {
        setLoading(false);
      }
    };

    fetchMeeting();
  }, [meetingId]);

  // 新しいuseEffectを追加: ポーリングでメッセージ取得
  useEffect(() => {
    if (!meeting) return;

    let lastTimestamp = 0;

    const pollMessages = async () => {
      try {
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || "https://your-api-gateway.amazonaws.com";
        const response = await fetch(
          `${apiUrl}/meetings/${meetingId}/messages?since=${lastTimestamp}&limit=100`
        );

        if (!response.ok) {
          console.error('Failed to poll messages', response.status);
          return;
        }

        const data = await response.json();

        // メッセージをtype別に分類・追加
        data.messages.forEach((msg: any) => {
          if (msg.type === 'transcript') {
            try {
              const transcriptData = JSON.parse(msg.message);
              setTranscripts(prev => [...prev, {
                timestamp: msg.timestamp,
                speakerId: transcriptData.speakerId,
                text: transcriptData.text,
                isFinal: transcriptData.isFinal,
              }]);
            } catch (e) {
              console.error('Failed to parse transcript', e);
            }
          } else if (msg.type === 'ai_intervention') {
            setAiMessages(prev => [...prev, {
              timestamp: msg.timestamp,
              message: msg.message,
            }]);
          } else if (msg.type === 'llm_call') {
            try {
              const logData = JSON.parse(msg.message);
              setLlmLogs(prev => [...prev, {
                timestamp: msg.timestamp,
                nodeId: logData.nodeId,
                prompt: logData.prompt,
                rawResponse: logData.rawResponse,
              }]);
            } catch (e) {
              console.error('Failed to parse LLM log', e);
            }
          }
        });

        // 最新タイムスタンプを更新
        if (data.messages.length > 0) {
          lastTimestamp = Math.max(...data.messages.map((m: any) => m.timestamp));
        }
      } catch (err) {
        console.error('Failed to poll messages', err);
      }
    };

    // 初回取得
    pollMessages();

    // 2秒ごとにポーリング
    const interval = setInterval(pollMessages, 2000);

    return () => clearInterval(interval);
  }, [meeting, meetingId]);

  // Load Grasp configs when config tab is active
  useEffect(() => {
    if (activeTab !== 'config') return;

    const fetchData = async () => {
      try {
        setConfigLoading(true);
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || "https://your-api-gateway.amazonaws.com";

        // Fetch all configs
        const configsResponse = await fetch(`${apiUrl}/grasp/configs`);
        if (!configsResponse.ok) {
          throw new Error('設定の取得に失敗しました');
        }
        const configsData = await configsResponse.json();
        const configs = configsData.configs || [];
        setGraspConfigs(configs);

        // Fetch current meeting config first to know which version is applied
        let appliedConfigId: string | null = null;
        const currentResponse = await fetch(`${apiUrl}/meetings/${meetingId}/grasp-config`);
        if (currentResponse.ok) {
          const currentData = await currentResponse.json();
          appliedConfigId = currentData.configId || null;
          setCurrentConfig({
            configId: currentData.configId || null,
            name: currentData.name || null,
            yaml: currentData.yaml || null,
          });
        } else {
          // Set empty config to indicate no config is applied
          setCurrentConfig({
            configId: null,
            name: null,
            yaml: null,
          });
        }

        // Group configs by name and auto-expand if a past version is currently applied
        const grouped = groupConfigsByName(configs).map((group) => {
          // Check if the applied config is a past version (not the latest) in this group
          const isPastVersionApplied = appliedConfigId &&
            group.versions.some((v) => v.configId === appliedConfigId) &&
            group.latestVersion.configId !== appliedConfigId;

          return {
            ...group,
            expanded: isPastVersionApplied || false,
          };
        });
        setGroupedConfigs(grouped);
      } catch (err) {
        console.error('Failed to load Grasp configs', err);
        // Ensure state reflects that no config is applied on error
        setCurrentConfig({
          configId: null,
          name: null,
          yaml: null,
        });
      } finally {
        setConfigLoading(false);
      }
    };

    fetchData();
  }, [activeTab, meetingId]);

  // Handle config selection
  const handleSelectConfig = async (configId: string, name: string) => {
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "https://your-api-gateway.amazonaws.com";
      const response = await fetch(`${apiUrl}/grasp/configs/${configId}`);

      if (!response.ok) {
        throw new Error('設定の取得に失敗しました');
      }

      const data = await response.json();
      setSelectedConfigId(configId);
      setSelectedConfigYaml(data.config.yaml);
      setEditedYaml(data.config.yaml);
      setOriginalYaml(data.config.yaml);
      setConfigName(name);
      setOriginalConfigName(name);
    } catch (err) {
      alert(err instanceof Error ? err.message : '設定の取得に失敗しました');
    }
  };

  // Toggle version expansion
  const toggleVersionExpansion = (name: string) => {
    setGroupedConfigs((prev) =>
      prev.map((group) =>
        group.name === name ? { ...group, expanded: !group.expanded } : group
      )
    );
  };

  // Open edit modal
  const openEditModal = () => {
    setOriginalYaml(selectedConfigYaml);
    setEditedYaml(selectedConfigYaml);
    setOriginalConfigName(configName);
    setIsEditModalOpen(true);
  };

  // Close edit modal with confirmation if there are changes
  const closeEditModal = () => {
    if (editedYaml !== originalYaml || configName !== originalConfigName) {
      if (confirm('編集内容を破棄しますか？')) {
        setEditedYaml(originalYaml);
        setConfigName(originalConfigName);
        setIsEditModalOpen(false);
      }
    } else {
      setIsEditModalOpen(false);
    }
  };

  // Save and apply from modal
  const saveAndApply = async () => {
    await handleApplyConfig(true);
    setIsEditModalOpen(false);
  };

  // Handle applying Grasp config to meeting
  const handleApplyConfig = async (saveAsNew: boolean = false) => {
    try {
      setConfigLoading(true);
      setApplySuccess(false);

      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "https://your-api-gateway.amazonaws.com";

      let configIdToApply = selectedConfigId;

      // If YAML or name was edited, save as new version first.
      // Note: The UI (ConfigTab.tsx) only passes `saveAsNew = true` when the YAML
      // has actually changed (`yamlChanged === true`). The additional checks here
      // (`editedYaml !== selectedConfigYaml || configName !== originalConfigName`) are a safeguard
      // that also covers name-only changes and prevents creating redundant configs
      // if this function is ever called differently.
      if (saveAsNew && (editedYaml !== selectedConfigYaml || configName !== originalConfigName)) {
        const saveName = configName || `設定_${Date.now()}`;
        const saveResponse = await fetch(`${apiUrl}/grasp/configs`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            name: saveName,
            yaml: editedYaml,
            createdAt: Date.now(),
          }),
        });

        if (!saveResponse.ok) {
          throw new Error('設定の保存に失敗しました');
        }

        const saveData = await saveResponse.json();
        configIdToApply = saveData.configId;

        // Reload configs to show new version
        const configsResponse = await fetch(`${apiUrl}/grasp/configs`);
        if (configsResponse.ok) {
          const configsData = await configsResponse.json();
          const configs = configsData.configs || [];
          setGraspConfigs(configs);
          setGroupedConfigs(groupConfigsByName(configs));
        }

        // Update selected/edited config state to reflect the newly saved config
        setSelectedConfigId(configIdToApply);
        setSelectedConfigYaml(editedYaml);
        setEditedYaml(editedYaml);
      }

      // Apply config to meeting
      if (!configIdToApply) {
        throw new Error('設定が選択されていません');
      }

      const response = await fetch(`${apiUrl}/meetings/${meetingId}/grasp-config`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ configId: configIdToApply }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || '設定の適用に失敗しました');
      }

      const result = await response.json();

      // Update current config
      const configResponse = await fetch(`${apiUrl}/grasp/configs/${result.configId}`);
      if (configResponse.ok) {
        const configData = await configResponse.json();
        setCurrentConfig({
          configId: result.configId,
          name: result.configName,
          yaml: configData.config.yaml,
        });
      }

      setApplySuccess(true);
      setTimeout(() => setApplySuccess(false), 3000);
    } catch (err) {
      alert(err instanceof Error ? err.message : '設定の適用に失敗しました');
    } finally {
      setConfigLoading(false);
    }
  };

  const handleLeave = async () => {
    if (!confirm("ボットを会議から退出させますか？")) return;

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "https://your-api-gateway.amazonaws.com";
      const response = await fetch(`${apiUrl}/recall/meetings/${meetingId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        throw new Error("ボットの退出に失敗しました");
      }

      router.push("/");
    } catch (err) {
      alert(err instanceof Error ? err.message : "エラーが発生しました");
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
          <p className="mt-2 text-gray-600">読み込み中...</p>
        </div>
      </div>
    );
  }

  if (error || !meeting) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 mb-4">{error || "会議が見つかりません"}</p>
          <Link
            href="/"
            className="text-blue-600 hover:text-blue-800 transition-colors"
          >
            ダッシュボードに戻る
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              <Link href="/" className="text-xl font-bold text-gray-900">
                Timtam Facilitator
              </Link>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <Link
            href="/"
            className="text-blue-600 hover:text-blue-800 transition-colors"
          >
            ← ダッシュボードに戻る
          </Link>
        </div>

        <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 mb-2">
                Meeting ID: {meeting.meetingId}
              </h1>
              <div className="flex items-center space-x-4 text-sm text-gray-600">
                <div className="flex items-center space-x-2">
                  <div
                    className={`w-2 h-2 rounded-full ${
                      meeting.status === "active" ? "bg-green-500" : "bg-gray-400"
                    }`}
                  ></div>
                  <span>Status: {meeting.status}</span>
                </div>
                {meeting.meetingCode && (
                  <span>Code: {meeting.meetingCode}</span>
                )}
                {meeting.recallBot && (
                  <>
                    <span>Platform: {meeting.recallBot.platform}</span>
                    <span>Bot Status: {meeting.recallBot.status}</span>
                  </>
                )}
              </div>
              {meeting.recallBot && (
                <p className="mt-2 text-sm text-gray-600">
                  URL: {meeting.recallBot.meetingUrl}
                </p>
              )}
            </div>
            <button
              onClick={handleLeave}
              data-testid="leave-meeting-button"
              className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 transition-colors"
            >
              ボット退出
            </button>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-sm">
          <div className="border-b border-gray-200">
            <nav className="flex space-x-8 px-6" aria-label="Tabs">
              {[
                { id: "transcript", label: "文字起こし" },
                { id: "ai", label: "AI応答" },
                { id: "logs", label: "LLMログ" },
                { id: "config", label: "Grasp設定" },
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as typeof activeTab)}
                  className={`py-4 px-1 border-b-2 font-medium text-sm transition-colors ${
                    activeTab === tab.id
                      ? "border-blue-500 text-blue-600"
                      : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                  }`}
                  data-testid={`${tab.id}-tab`}
                >
                  {tab.label}
                </button>
              ))}
            </nav>
          </div>

          <div className="p-6">
            {activeTab === "transcript" && (
              <div className="space-y-3" data-testid="transcription-section">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">
                  リアルタイム文字起こし
                </h2>
                {transcripts.length === 0 ? (
                  <p className="text-gray-500 text-center py-8">
                    まだ文字起こしがありません
                  </p>
                ) : (
                  <div className="space-y-2 max-h-96 overflow-y-auto" data-testid="transcription-output">
                    {transcripts.map((entry, index) => (
                      <div
                        key={index}
                        className="flex space-x-3 text-sm"
                      >
                        <span className="text-gray-500 w-16 flex-shrink-0">
                          {new Date(entry.timestamp).toLocaleTimeString()}
                        </span>
                        <span className="text-gray-700 font-medium w-24 flex-shrink-0">
                          {entry.speakerId}:
                        </span>
                        <span className={entry.isFinal ? "text-gray-900" : "text-gray-400"}>
                          {entry.text}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeTab === "ai" && (
              <div className="space-y-4" data-testid="ai-assistant-section">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">
                  AI介入
                </h2>
                {aiMessages.length === 0 ? (
                  <p className="text-gray-500 text-center py-8">
                    まだAI介入がありません
                  </p>
                ) : (
                  <div className="space-y-4" data-testid="ai-assistant-output">
                    {aiMessages.map((msg, index) => (
                      <div
                        key={index}
                        className="border border-gray-200 rounded-lg p-4"
                      >
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm text-gray-500">
                            {new Date(msg.timestamp).toLocaleTimeString()}
                          </span>
                          {msg.nodeId && (
                            <span className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">
                              Grasp: {msg.nodeId}
                            </span>
                          )}
                        </div>
                        <p className="text-gray-900">{msg.message}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeTab === "logs" && (
              <div className="space-y-4">
                <h2 className="text-lg font-semibold text-gray-900 mb-4">
                  LLM呼び出しログ
                </h2>
                {llmLogs.length === 0 ? (
                  <p className="text-gray-500 text-center py-8">
                    まだLLMログがありません
                  </p>
                ) : (
                  <div className="space-y-4">
                    {llmLogs.map((log, index) => (
                      <div
                        key={index}
                        className="border border-gray-200 rounded-lg p-4"
                      >
                        <div className="flex items-center justify-between mb-3">
                          <span className="text-sm text-gray-500">
                            {new Date(log.timestamp).toLocaleTimeString()}
                          </span>
                          {log.nodeId && (
                            <span className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">
                              Grasp: {log.nodeId}
                            </span>
                          )}
                        </div>
                        <div className="space-y-3">
                          <div>
                            <h4 className="text-sm font-medium text-gray-700 mb-1">
                              Prompt ({log.prompt.length} chars):
                            </h4>
                            <pre className="text-xs bg-gray-50 p-3 rounded overflow-x-auto text-gray-800">
                              {log.prompt}
                            </pre>
                          </div>
                          <div>
                            <h4 className="text-sm font-medium text-gray-700 mb-1">
                              Response ({log.rawResponse.length} chars):
                            </h4>
                            <pre className="text-xs bg-gray-50 p-3 rounded overflow-x-auto text-gray-800">
                              {log.rawResponse}
                            </pre>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeTab === "config" && (
              <ConfigTab
                meetingId={meetingId}
                groupedConfigs={groupedConfigs}
                currentConfig={currentConfig}
                selectedConfigId={selectedConfigId}
                selectedConfigYaml={selectedConfigYaml}
                editedYaml={editedYaml}
                isEditModalOpen={isEditModalOpen}
                configName={configName}
                configLoading={configLoading}
                applySuccess={applySuccess}
                onSelectConfig={handleSelectConfig}
                onToggleVersionExpansion={toggleVersionExpansion}
                onEditYamlChange={setEditedYaml}
                onConfigNameChange={setConfigName}
                onApplyConfig={handleApplyConfig}
                onOpenEditModal={openEditModal}
                onCloseEditModal={closeEditModal}
                onSaveAndApply={saveAndApply}
              />
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
