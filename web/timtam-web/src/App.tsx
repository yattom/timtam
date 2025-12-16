import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ConsoleLogger,
  DefaultDeviceController,
  DefaultMeetingSession,
  LogLevel,
  MeetingSessionConfiguration,
  AudioVideoFacade,
  DeviceChangeObserver,
} from 'amazon-chime-sdk-js';
import { addAttendee, createMeeting, getConfig, startTranscription, stopTranscription, getAiMessages, AiMessage, getOrchestratorPrompt, updateOrchestratorPrompt } from './api';

export function App() {
  const [apiBaseUrl, setApiBaseUrl] = useState<string>('');
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [error, setError] = useState<string>('');

  const [meetingId, setMeetingId] = useState<string>('');
  const [joinMeetingId, setJoinMeetingId] = useState<string>('');
  const [attendeeId, setAttendeeId] = useState<string>('');

  const [audioInputs, setAudioInputs] = useState<MediaDeviceInfo[]>([]);
  const [audioOutputs, setAudioOutputs] = useState<MediaDeviceInfo[]>([]);
  const [selectedMic, setSelectedMic] = useState<string>('');
  const [selectedSpeaker, setSelectedSpeaker] = useState<string>('');
  const [joined, setJoined] = useState(false);
  const [muted, setMuted] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [micPermission, setMicPermission] = useState<'unknown' | 'granted' | 'denied'>('unknown');
  // Transcript states
  const [partialText, setPartialText] = useState<string>('');
  const [finalSegments, setFinalSegments] = useState<{ text: string; at: number }[]>([]);
  // AI messages
  const [aiMessages, setAiMessages] = useState<AiMessage[]>([]);
  const [lastAiMessageTimestamp, setLastAiMessageTimestamp] = useState<number>(0);
  // AI output area resize
  const [aiOutputHeight, setAiOutputHeight] = useState<number>(300);
  // Orchestrator prompt configuration
  const [orchestratorPrompt, setOrchestratorPrompt] = useState<string>('');
  const [promptEditing, setPromptEditing] = useState<string>('');
  const [promptSaving, setPromptSaving] = useState(false);
  const [promptMessage, setPromptMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  // (debug states removed)

  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const meetingRef = useRef<DefaultMeetingSession | null>(null);
  const audioVideoRef = useRef<AudioVideoFacade | null>(null);
  const transcriptHandlerRef = useRef<((event: any) => void) | null>(null);
  const aiOutputRef = useRef<HTMLDivElement | null>(null);
  const deviceController = useMemo(() => new DefaultDeviceController(new ConsoleLogger('dc', LogLevel.WARN)), []);

  useEffect(() => {
    (async () => {
      try {
        const cfg = await getConfig();
        setApiBaseUrl(cfg.apiBaseUrl);
      } catch (e: any) {
        setError(e?.message || String(e));
      } finally {
        setLoadingConfig(false);
      }
    })();
  }, []);

  // Load orchestrator prompt on mount
  useEffect(() => {
    if (!apiBaseUrl) return;
    (async () => {
      try {
        const result = await getOrchestratorPrompt();
        setOrchestratorPrompt(result.prompt);
        setPromptEditing(result.prompt);
      } catch (e: any) {
        console.error('Failed to load orchestrator prompt:', e?.message || e);
      }
    })();
  }, [apiBaseUrl]);

  // Poll for AI messages when joined
  useEffect(() => {
    if (!joined || !meetingId) return;

    let lastTimestamp = 0;

    const pollMessages = async () => {
      try {
        const messages = await getAiMessages(meetingId, lastTimestamp);
        if (messages.length > 0) {
          setAiMessages(prev => [...prev, ...messages]);
          const maxTimestamp = Math.max(...messages.map(m => m.timestamp));
          lastTimestamp = maxTimestamp;
        }
      } catch (e: any) {
        console.error('Failed to poll AI messages:', e?.message || e);
      }
    };

    // Poll every 2 seconds
    const intervalId = setInterval(pollMessages, 2000);
    // Initial poll
    pollMessages();

    return () => clearInterval(intervalId);
  }, [joined, meetingId]);

  // Auto-scroll AI output area when new messages arrive
  useEffect(() => {
    const container = aiOutputRef.current;
    if (!container || aiMessages.length === 0) return;

    // Check if user is at the bottom (with 50px tolerance)
    const isAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 50;

    if (isAtBottom) {
      // Auto-scroll to bottom
      container.scrollTop = container.scrollHeight;
    }
  }, [aiMessages]);

  useEffect(() => {
    // Observe microphone permission if supported
    let permStatus: PermissionStatus | null = null;
    if ((navigator as any).permissions?.query) {
      (navigator as any).permissions
        .query({ name: 'microphone' as PermissionName })
        .then((status: PermissionStatus) => {
          permStatus = status;
          setMicPermission(status.state as any);
          status.onchange = () => setMicPermission(status.state as any);
        })
        .catch(() => {});
    }

    const observer: DeviceChangeObserver = {
      audioInputsChanged: (devices) => setAudioInputs(devices ?? []),
      audioOutputsChanged: (devices) => setAudioOutputs(devices ?? []),
    };
    deviceController.addDeviceChangeObserver(observer);
    (async () => {
      const inputs = await deviceController.listAudioInputDevices();
      const outputs = await deviceController.listAudioOutputDevices();
      setAudioInputs(inputs);
      setAudioOutputs(outputs);
      if (inputs[0]) setSelectedMic(inputs[0].deviceId ?? '');
      if (outputs[0]) setSelectedSpeaker(outputs[0].deviceId ?? '');
    })();
    return () => {
      if (permStatus) permStatus.onchange = null as any;
      deviceController.removeDeviceChangeObserver(observer);
    };
  }, [deviceController]);

  const requestMicPermission = async () => {
    setError('');
    try {
      if (!navigator?.mediaDevices?.getUserMedia) throw new Error('getUserMedia not supported');
      // First, check if any audioinput devices exist
      const pre = await navigator.mediaDevices.enumerateDevices();
      const hasMic = pre.some(d => d.kind === 'audioinput');
      if (!hasMic) {
        throw new Error('Requested device not found: この端末で利用可能なマイクが見つからない');
      }
      // Request minimal audio access (no deviceId specified to avoid NotFoundError for stale ids)
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true } as any,
      });
      stream.getTracks().forEach(t => t.stop());
      // refresh devices after permission
      const inputs = await deviceController.listAudioInputDevices();
      const outputs = await deviceController.listAudioOutputDevices();
      setAudioInputs(inputs);
      setAudioOutputs(outputs);
      if (inputs[0]) setSelectedMic(inputs[0].deviceId ?? '');
      if (outputs[0]) setSelectedSpeaker(outputs[0].deviceId ?? '');
      setMicPermission('granted');
    } catch (e: any) {
      setMicPermission('denied');
      const name = e?.name ? `${e.name}: ` : '';
      setError(name + (e?.message || String(e)));
    }
  };

  const refreshDevices = async () => {
    try {
      const inputs = await deviceController.listAudioInputDevices();
      const outputs = await deviceController.listAudioOutputDevices();
      setAudioInputs(inputs);
      setAudioOutputs(outputs);
      if (!selectedMic && inputs[0]) setSelectedMic(inputs[0].deviceId ?? '');
      if (!selectedSpeaker && outputs[0]) setSelectedSpeaker(outputs[0].deviceId ?? '');
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  };

  const configureAndStart = async (meeting: any, attendee: any) => {
    const logger = new ConsoleLogger('Chime', LogLevel.WARN);
    const configuration = new MeetingSessionConfiguration(meeting, attendee);
    const meetingSession = new DefaultMeetingSession(configuration, logger, deviceController);
    meetingRef.current = meetingSession as DefaultMeetingSession;
    const av = meetingSession.audioVideo;
    audioVideoRef.current = av;

    // Bind speaker output first so remote audio can play even without mic
    if (audioElRef.current) {
      await av.bindAudioElement(audioElRef.current);
      // Try to direct output to selected speaker if supported
      try {
        if (selectedSpeaker && 'setSinkId' in (audioElRef.current as any)) {
          await (audioElRef.current as any).setSinkId(selectedSpeaker);
        } else if ('setSinkId' in (audioElRef.current as any)) {
          await (audioElRef.current as any).setSinkId('default');
        }
      } catch {
        // Ignore setSinkId failures (e.g., HTTP or unsupported)
      }
    }

    // Start mic if available; otherwise join receive-only
    try {
      if (selectedMic) {
        await av.startAudioInput(selectedMic as any);
      } else if (audioInputs.length > 0) {
        // In some SDK versions, startAudioInput requires a device parameter; attempt with the first device
        await av.startAudioInput(audioInputs[0].deviceId as any);
      }
    } catch {
      // ignore; proceed receive-only
    }
    await av.start();
    // Subscribe to transcription events (if supported by SDK)
    try {
      const tc: any = (av as any).transcriptionController;
      const available = !!(tc && typeof tc.subscribeToTranscriptEvent === 'function');
      if (available) {
        const handler = (event: any) => {
          try {
            // Some SDKs provide different casing/shape; normalize
            const rawResults = event?.Transcript?.Results ?? event?.transcript?.results ?? event?.results ?? [];
            const results: any[] = Array.isArray(rawResults) ? rawResults : [];
            if (!Array.isArray(results) || results.length === 0) {
              return;
            }
            for (const r of results) {
              const isPartial = !!(r?.IsPartial ?? r?.isPartial);
              const alt = r?.Alternatives?.[0] ?? r?.alternatives?.[0];
              // Text may be in alt.Transcript or needs to be reconstructed from Items
              let text: string = alt?.Transcript ?? alt?.transcript ?? '';
              if (!text && Array.isArray(alt?.Items)) {
                text = (alt.Items as any[]).map((it: any) => it?.Content ?? it?.content ?? '').join('');
              }
              if (!text) continue;
              if (isPartial) {
                setPartialText(text);
              } else {
                // Finalized: append and clear partial if it matches
                setFinalSegments(prev => [...prev, { text, at: Date.now() }]);
                setPartialText('');
              }
            }
          } catch {
            // ignore parsing errors
          }
        };
        transcriptHandlerRef.current = handler;
        tc.subscribeToTranscriptEvent(handler);
      }
      // Fallback subscription API for older SDKs if available
      const fallback = (av as any).realtimeSubscribeToReceiveTranscriptionEvent;
      if (typeof fallback === 'function') {
        const fbHandler = (evt: any) => {
          try {
            const results: any[] = evt?.results ?? evt?.Transcript?.Results ?? [];
            if (!Array.isArray(results)) return;
            for (const r of results) {
              const isPartial = !!(r?.isPartial ?? r?.IsPartial);
              const alt = r?.alternatives?.[0] ?? r?.Alternatives?.[0];
              let text: string = alt?.transcript ?? alt?.Transcript ?? '';
              if (!text && Array.isArray(alt?.Items)) {
                text = (alt.Items as any[]).map((it: any) => it?.Content ?? it?.content ?? '').join('');
              }
              if (!text) continue;
              if (isPartial) {
                setPartialText(text);
              } else {
                setFinalSegments(prev => [...prev, { text, at: Date.now() }]);
                setPartialText('');
              }
            }
          } catch {}
        };
        fallback.call(av, fbHandler);
      }
    } catch {
      // ignore if not supported
    }
    setJoined(true);
  };

  const onCreateAndJoin = async () => {
    setError('');
    try {
      const meetingResp = await createMeeting();
      const createdMeetingId: string | undefined = meetingResp?.meeting?.MeetingId;
      if (!createdMeetingId) throw new Error('CreateMeeting response missing meeting.MeetingId');
      const attendeeResp = await addAttendee(createdMeetingId);
      const createdAttendeeId: string | undefined = attendeeResp?.attendee?.AttendeeId;

      setMeetingId(createdMeetingId);
      setAttendeeId(createdAttendeeId || '');
      await configureAndStart(meetingResp.meeting, attendeeResp.attendee);
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  };

  const onJoinExisting = async () => {
    setError('');
    try {
      const id = (joinMeetingId || '').trim();
      if (!id) throw new Error('meetingId を入力してね');
      const attendeeResp = await addAttendee(id);
      const meetingObj = attendeeResp?.meeting;
      const attendeeObj = attendeeResp?.attendee;
      const createdAttendeeId: string | undefined = attendeeObj?.AttendeeId;
      if (!meetingObj?.MeetingId) throw new Error('指定の meetingId が見つからないか、取得に失敗した');
      setMeetingId(meetingObj.MeetingId);
      setAttendeeId(createdAttendeeId || '');
      await configureAndStart(meetingObj, attendeeObj);
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  };

  const onLeave = async () => {
    try {
      // Unsubscribe transcript events
      const av: any = audioVideoRef.current as any;
      const tc: any = av?.transcriptionController;
      if (tc && transcriptHandlerRef.current && typeof tc.unsubscribeFromTranscriptEvent === 'function') {
        tc.unsubscribeFromTranscriptEvent(transcriptHandlerRef.current);
      }
      audioVideoRef.current?.stop();
      meetingRef.current?.destroy();
    } catch {}
    setJoined(false);
    setTranscribing(false);
    setPartialText('');
    setFinalSegments([]);
    setAiMessages([]);
    setLastAiMessageTimestamp(0);
  };

  const onToggleMute = async () => {
    const av = audioVideoRef.current;
    if (!av) return;
    try {
      if (muted) {
        await av.realtimeUnmuteLocalAudio();
        setMuted(false);
      } else {
        await av.realtimeMuteLocalAudio();
        setMuted(true);
      }
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  };

  const onStartTranscription = async () => {
    if (!meetingId) return;
    try {
      await startTranscription(meetingId);
      setTranscribing(true);
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  };

  const onStopTranscription = async () => {
    if (!meetingId) return;
    try {
      await stopTranscription(meetingId);
      setTranscribing(false);
      setPartialText('');
    } catch (e: any) {
      setError(e?.message || String(e));
    }
  };

  const onChangeMic = async (id: string) => {
    setSelectedMic(id);
    // Use audioVideo API; cast to any to accommodate SDK typing differences across versions
    const av: any = audioVideoRef.current as any;
    if (av && typeof av.chooseAudioInputDevice === 'function') {
      await av.chooseAudioInputDevice(id);
    }
  };

  const onChangeSpeaker = async (id: string) => {
    setSelectedSpeaker(id);
    // amazon-chime-sdk-js uses setSinkId on the bound audio element
    if (audioElRef.current && 'setSinkId' in (audioElRef.current as any)) {
      try { await (audioElRef.current as any).setSinkId(id); } catch (e) {
        // Some browsers require HTTPS for setSinkId; ignore failure
      }
    }
  };

  const onResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = aiOutputHeight;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const deltaY = moveEvent.clientY - startY;
      const newHeight = Math.max(100, Math.min(800, startHeight + deltaY));
      setAiOutputHeight(newHeight);
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  };

  const onSavePrompt = async () => {
    setPromptSaving(true);
    setPromptMessage(null);
    try {
      await updateOrchestratorPrompt(promptEditing);
      setOrchestratorPrompt(promptEditing);
      setPromptMessage({ type: 'success', text: 'プロンプトを保存しました' });
      setTimeout(() => setPromptMessage(null), 3000);
    } catch (e: any) {
      setPromptMessage({ type: 'error', text: e?.message || String(e) });
    } finally {
      setPromptSaving(false);
    }
  };

  const onResetPrompt = () => {
    setPromptEditing(orchestratorPrompt);
    setPromptMessage(null);
  };

  return (
    <div style={{ fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif', padding: 16, maxWidth: 900 }}>
      <h1 style={{ marginTop: 0 }}>timtam web — 会議MVP</h1>
      {loadingConfig ? (
        <p>設定を取得中...</p>
      ) : (
        <p style={{ color: '#666' }}>API: {apiBaseUrl || '(未取得)'}</p>
      )}
      {error && (
        <div style={{ color: 'white', background: '#c0392b', padding: 8, borderRadius: 4, marginBottom: 12 }}>{error}</div>
      )}

      <section style={{ display: 'grid', gap: 12, marginBottom: 16 }}>
        {micPermission !== 'granted' && (
          <div style={{ background: '#fffbe6', border: '1px solid #f1c40f', padding: 8, borderRadius: 4 }}>
            <div style={{ marginBottom: 8 }}>マイクの許可が必要です。ボタンを押して許可ダイアログを出してください。</div>
            <button onClick={requestMicPermission}>マイク許可をリクエスト</button>
          </div>
        )}
        <div>
          <label>マイク: </label>
          <select value={selectedMic} onChange={(e) => onChangeMic(e.target.value)} disabled={joined && muted}>
            {audioInputs.map(d => (
              <option key={d.deviceId} value={d.deviceId}>{d.label || d.deviceId}</option>
            ))}
          </select>
          <button style={{ marginLeft: 8 }} onClick={refreshDevices}>デバイス更新</button>
        </div>
        <div>
          <label>スピーカー: </label>
          <select value={selectedSpeaker} onChange={(e) => onChangeSpeaker(e.target.value)}>
            {audioOutputs.map(d => (
              <option key={d.deviceId} value={d.deviceId}>{d.label || d.deviceId}</option>
            ))}
          </select>
          {audioOutputs.length === 0 && (
            <span style={{ marginLeft: 8, color: '#666' }}>出力デバイスが見つからない場合も再生は既定デバイスで行われます。</span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {!joined ? (
            <>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <button onClick={onCreateAndJoin} disabled={!apiBaseUrl}>新規作成して入室</button>
                <span style={{ color: '#666' }}>または 既存会議に入室:</span>
                <input
                  type="text"
                  placeholder="meetingId"
                  value={joinMeetingId}
                  onChange={(e) => setJoinMeetingId(e.target.value)}
                  style={{ minWidth: 260 }}
                />
                <button onClick={onJoinExisting} disabled={!apiBaseUrl}>このIDで入室</button>
              </div>
            </>
          ) : (
            <>
              <button onClick={onLeave}>退室</button>
              <button onClick={onToggleMute}>{muted ? 'ミュート解除' : 'ミュート'}</button>
              {!transcribing ? (
                <button onClick={onStartTranscription}>文字起こし開始</button>
              ) : (
                <button onClick={onStopTranscription}>停止</button>
              )}
            </>
          )}
        </div>
        <audio ref={audioElRef} autoPlay />
      </section>

      <section style={{ display: 'grid', gap: 8 }}>
        <h3>AIアシスタント</h3>
        <div style={{ position: 'relative' }}>
          <div
            ref={aiOutputRef}
            style={{
              border: '1px solid #ddd',
              borderRadius: 6,
              padding: 12,
              height: aiOutputHeight,
              background: '#f0f8ff',
              overflowY: 'auto',
              overflowX: 'hidden'
            }}
          >
            <div style={{ display: 'grid', gap: 8 }}>
              {aiMessages.map((msg, i) => (
                <div key={msg.timestamp + '-' + i} style={{ padding: 8, background: '#e6f3ff', borderRadius: 4, borderLeft: '3px solid #2980b9' }}>
                  <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>
                    {new Date(msg.timestamp).toLocaleTimeString('ja-JP')}
                  </div>
                  <div style={{ lineHeight: 1.5 }}>{msg.message}</div>
                </div>
              ))}
              {aiMessages.length === 0 && (
                <div style={{ color: '#888' }}>AIアシスタントからのメッセージがここに表示される</div>
              )}
            </div>
          </div>
          <div
            onMouseDown={onResizeStart}
            style={{
              position: 'absolute',
              bottom: 0,
              right: 0,
              width: 20,
              height: 20,
              cursor: 'ns-resize',
              background: 'linear-gradient(135deg, transparent 50%, #999 50%)',
              borderBottomRightRadius: 6
            }}
          />
        </div>

        <h3>文字起こし（擬似リアルタイム）</h3>
        <div style={{ border: '1px solid #ddd', borderRadius: 6, padding: 12, minHeight: 120, background: '#fafafa' }}>
          <div style={{ display: 'grid', gap: 6 }}>
            {partialText && (
              <div style={{ color: '#555' }}>{partialText}<span style={{ opacity: 0.5 }}> ▋</span></div>
            )}
            {[...finalSegments].reverse().map((seg, i) => (
              <div key={seg.at + '-' + i} style={{ lineHeight: 1.5 }}>{seg.text}</div>
            ))}
            {!partialText && finalSegments.length === 0 && (
              <div style={{ color: '#888' }}>ここに文字起こしが表示される（「文字起こし開始」を押して話してみてね）</div>
            )}
          </div>
        </div>

        <h3>オーケストレーター設定</h3>
        <div style={{ border: '1px solid #ddd', borderRadius: 6, padding: 12, background: '#fff9f0' }}>
          <div style={{ marginBottom: 8, color: '#666', fontSize: 14 }}>
            介入判断プロンプト（会議の直近発話に対してAIが判断する際の指示）:
          </div>
          <textarea
            value={promptEditing}
            onChange={(e) => setPromptEditing(e.target.value)}
            rows={4}
            style={{
              width: '100%',
              fontFamily: 'monospace',
              fontSize: 14,
              padding: 8,
              borderRadius: 4,
              border: '1px solid #ccc',
              resize: 'vertical'
            }}
            disabled={promptSaving}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
            <button onClick={onSavePrompt} disabled={promptSaving || promptEditing === orchestratorPrompt}>
              {promptSaving ? '保存中...' : '保存'}
            </button>
            <button onClick={onResetPrompt} disabled={promptSaving || promptEditing === orchestratorPrompt}>
              リセット
            </button>
            {promptMessage && (
              <span style={{
                color: promptMessage.type === 'success' ? '#27ae60' : '#c0392b',
                fontSize: 14,
                marginLeft: 4
              }}>
                {promptMessage.text}
              </span>
            )}
          </div>
        </div>

        <h3>ログ</h3>
        <p style={{ color: '#666' }}>meetingId: {meetingId || '-'} <button onClick={() => navigator.clipboard?.writeText(meetingId)} disabled={!meetingId}>コピー</button></p>
        <p style={{ color: '#666' }}>attendeeId: {attendeeId || '-'}</p>
      </section>
    </div>
  );
}
